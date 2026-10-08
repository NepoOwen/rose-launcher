use serde::{Deserialize, Serialize};
use sysinfo::System;
use std::fs;
use std::sync::Mutex;
use std::collections::HashSet;

mod glyph_login_helper;
mod trove_launcher;
mod updater;
use glyph_login_helper::{
    GlyphLoginRequest,
    GlyphLoginResult,
    login_account_and_store,
    touch_account_saved,
    resolve_trove_exe_path,
    resolve_trove_x64_exe_path_for_region,
    get_auth_server_args,
};
use updater::{UpdaterState, check_trove_update, apply_trove_update, download_trove_fresh, cancel_trove_update, pause_trove_update, resume_trove_update, has_local_manifest};
use tauri::Manager;

#[cfg(windows)]
use std::ptr::null_mut;
#[cfg(windows)]
use std::mem;
#[cfg(windows)]
use winapi::um::processthreadsapi::{
    CreateProcessW, ResumeThread,
    GetThreadContext, SetThreadContext,
    STARTUPINFOW, PROCESS_INFORMATION, TerminateProcess
};
#[cfg(windows)]
use winapi::um::winnt::HANDLE;

#[cfg(windows)]
extern "system" {
    fn Wow64GetThreadContext(hThread: HANDLE, lpContext: *mut Wow64Context) -> i32;
    fn Wow64SetThreadContext(hThread: HANDLE, lpContext: *const Wow64Context) -> i32;
}
#[cfg(windows)]
use winapi::um::memoryapi::{
    VirtualAllocEx, WriteProcessMemory
};
#[cfg(windows)]
use winapi::um::winnt::{
    MEM_COMMIT, MEM_RESERVE, PAGE_EXECUTE_READWRITE,
    IMAGE_DOS_HEADER, IMAGE_NT_HEADERS32, IMAGE_NT_HEADERS64, IMAGE_SECTION_HEADER,
    CONTEXT,
};
#[cfg(windows)]
use winapi::um::handleapi::CloseHandle;
#[cfg(windows)]
use winapi::um::winbase::{CREATE_SUSPENDED, CREATE_NO_WINDOW, STARTF_USESHOWWINDOW};
#[cfg(windows)]
use winapi::um::winuser::SW_HIDE;
#[cfg(windows)]
use winapi::shared::minwindef::{DWORD, BYTE};

type ImageNtHeaders = IMAGE_NT_HEADERS32;

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct Wow64Context {
    ContextFlags: DWORD,
    Dr0: DWORD,
    Dr1: DWORD,
    Dr2: DWORD,
    Dr3: DWORD,
    Dr6: DWORD,
    Dr7: DWORD,
    FloatSave: [BYTE; 112],
    SegGs: DWORD,
    SegFs: DWORD,
    SegEs: DWORD,
    SegDs: DWORD,
    Edi: DWORD,
    Esi: DWORD,
    Ebx: DWORD,
    Edx: DWORD,
    Ecx: DWORD,
    Eax: DWORD,
    Ebp: DWORD,
    Eip: DWORD,
    SegCs: DWORD,
    EFlags: DWORD,
    Esp: DWORD,
    SegSs: DWORD,
    ExtendedRegisters: [BYTE; 512],
}

#[cfg(windows)]
const WOW64_CONTEXT_FULL: DWORD = 0x10007;

pub(crate) struct LauncherState {
    launching_emails: Mutex<HashSet<String>>,
}

impl LauncherState {
    fn new() -> Self {
        Self {
            launching_emails: Mutex::new(HashSet::new()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct ProcessInfo {
    pid: u32,
    name: String,
    exe_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TroveExecutableInfo {
    path: String,
    file_name: String,
    size_bytes: u64,
    is_exe_extension: bool,
    is_supported_name: bool,
    is_expected_dir: bool,
    is_valid_for_glyph: bool,
    is_live: bool,
    is_pts: bool,
    message: String,
}

#[cfg(windows)]
fn hollow_process_with_pe(exe_bytes: &[u8], h_process: HANDLE, h_thread: HANDLE) -> Result<(), String> {
    unsafe {
        if exe_bytes.len() < mem::size_of::<IMAGE_DOS_HEADER>() {
            return Err("Invalid PE file: too small".to_string());
        }
        let dos_header = &*(exe_bytes.as_ptr() as *const IMAGE_DOS_HEADER);
        if dos_header.e_magic != 0x5A4D {
            return Err("Invalid PE file: bad DOS signature".to_string());
        }
        let nt_off = dos_header.e_lfanew as usize;
        if exe_bytes.len() < nt_off + mem::size_of::<ImageNtHeaders>() {
            return Err("Invalid PE file: NT headers out of bounds".to_string());
        }
        let nt = &*(exe_bytes.as_ptr().add(nt_off) as *const ImageNtHeaders);
        if nt.Signature != 0x4550 {
            return Err("Invalid PE file: bad NT signature".to_string());
        }
        let entry_point   = nt.OptionalHeader.AddressOfEntryPoint;
        let size_of_image = nt.OptionalHeader.SizeOfImage as usize;
        let size_of_hdr   = nt.OptionalHeader.SizeOfHeaders as usize;

        let mut ctx: Wow64Context = mem::zeroed();
        ctx.ContextFlags = WOW64_CONTEXT_FULL;
        if Wow64GetThreadContext(h_thread, &mut ctx as *mut _) == 0 {
            return Err(format!(
                "Failed to get thread context (x86/WOW64): {}. This is usually an architecture mismatch or blocked thread-context access.",
                std::io::Error::last_os_error()
            ));
        }

        let remote_image = VirtualAllocEx(
            h_process, null_mut(), size_of_image,
            MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE,
        );
        if remote_image.is_null() {
            return Err(format!("Failed to allocate memory: {}", std::io::Error::last_os_error()));
        }

        if WriteProcessMemory(h_process, remote_image, exe_bytes.as_ptr() as *const _, size_of_hdr, null_mut()) == 0 {
            return Err("Failed to write PE headers".to_string());
        }

        let num_sections = nt.FileHeader.NumberOfSections as usize;
        let section_base = nt_off + mem::size_of::<ImageNtHeaders>();
        for i in 0..num_sections {
            let sec_off = section_base + i * mem::size_of::<IMAGE_SECTION_HEADER>();
            if sec_off + mem::size_of::<IMAGE_SECTION_HEADER>() > exe_bytes.len() { break; }
            let sec = &*(exe_bytes.as_ptr().add(sec_off) as *const IMAGE_SECTION_HEADER);
            if sec.SizeOfRawData > 0 {
                let dest = (remote_image as usize + sec.VirtualAddress as usize) as *mut _;
                let src  = exe_bytes.as_ptr().add(sec.PointerToRawData as usize);
                let size = sec.SizeOfRawData.min(*sec.Misc.VirtualSize()) as usize;
                if sec.PointerToRawData as usize + size <= exe_bytes.len() {
                    WriteProcessMemory(h_process, dest, src as *const _, size, null_mut());
                }
            }
        }

        let new_base = remote_image as DWORD;
        WriteProcessMemory(
            h_process, (ctx.Ebx + 8) as *mut _,
            &new_base as *const _ as *const _, mem::size_of::<DWORD>(), null_mut(),
        );

        ctx.Eax = remote_image as u32 + entry_point;
        if Wow64SetThreadContext(h_thread, &ctx as *const _) == 0 {
            return Err(format!("Failed to set thread context: {}", std::io::Error::last_os_error()));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn hollow_process_x64(exe_bytes: &[u8], h_process: HANDLE, h_thread: HANDLE) -> Result<(), String> {
    unsafe {
        if exe_bytes.len() < mem::size_of::<IMAGE_DOS_HEADER>() {
            return Err("Invalid PE file: too small".to_string());
        }
        let dos_header = &*(exe_bytes.as_ptr() as *const IMAGE_DOS_HEADER);
        if dos_header.e_magic != 0x5A4D {
            return Err("Invalid PE file: bad DOS signature".to_string());
        }
        let nt_off = dos_header.e_lfanew as usize;
        if exe_bytes.len() < nt_off + mem::size_of::<IMAGE_NT_HEADERS64>() {
            return Err("Invalid PE file: NT headers out of bounds".to_string());
        }
        let nt = &*(exe_bytes.as_ptr().add(nt_off) as *const IMAGE_NT_HEADERS64);
        if nt.Signature != 0x4550 {
            return Err("Invalid PE file: bad NT signature".to_string());
        }

        let entry_point   = nt.OptionalHeader.AddressOfEntryPoint;
        let size_of_image = nt.OptionalHeader.SizeOfImage as usize;
        let size_of_hdr   = nt.OptionalHeader.SizeOfHeaders as usize;

        let mut ctx: CONTEXT = mem::zeroed();
        ctx.ContextFlags = 0x10000B;
        if GetThreadContext(h_thread, &mut ctx) == 0 {
            return Err(format!(
                "Failed to get thread context (x64): {}. This is usually an architecture mismatch or blocked thread-context access.",
                std::io::Error::last_os_error()
            ));
        }

        let peb_addr = ctx.Rdx;

        let remote_image = VirtualAllocEx(
            h_process, null_mut(), size_of_image,
            MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE,
        );
        if remote_image.is_null() {
            return Err(format!("Failed to allocate memory: {}", std::io::Error::last_os_error()));
        }

        if WriteProcessMemory(h_process, remote_image, exe_bytes.as_ptr() as *const _, size_of_hdr, null_mut()) == 0 {
            return Err("Failed to write PE headers".to_string());
        }

        let num_sections  = nt.FileHeader.NumberOfSections as usize;
        let section_base  = nt_off + mem::size_of::<IMAGE_NT_HEADERS64>();
        for i in 0..num_sections {
            let sec_off = section_base + i * mem::size_of::<IMAGE_SECTION_HEADER>();
            if sec_off + mem::size_of::<IMAGE_SECTION_HEADER>() > exe_bytes.len() { break; }
            let sec = &*(exe_bytes.as_ptr().add(sec_off) as *const IMAGE_SECTION_HEADER);
            if sec.SizeOfRawData > 0 {
                let dest = (remote_image as usize + sec.VirtualAddress as usize) as *mut _;
                let src  = exe_bytes.as_ptr().add(sec.PointerToRawData as usize);
                let size = sec.SizeOfRawData.min(*sec.Misc.VirtualSize()) as usize;
                if sec.PointerToRawData as usize + size <= exe_bytes.len() {
                    WriteProcessMemory(h_process, dest, src as *const _, size, null_mut());
                }
            }
        }

        let new_base: u64 = remote_image as u64;
        WriteProcessMemory(
            h_process, (peb_addr + 0x10) as *mut _,
            &new_base as *const _ as *const _, mem::size_of::<u64>(), null_mut(),
        );

        ctx.Rcx = remote_image as u64 + entry_point as u64;
        if SetThreadContext(h_thread, &ctx) == 0 {
            return Err(format!("Failed to set thread context: {}", std::io::Error::last_os_error()));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn quote_windows_arg(arg: &str) -> String {
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    let mut backslashes = 0usize;

    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                for _ in 0..(backslashes * 2 + 1) {
                    out.push('\\');
                }
                out.push('"');
                backslashes = 0;
            }
            _ => {
                for _ in 0..backslashes {
                    out.push('\\');
                }
                backslashes = 0;
                out.push(ch);
            }
        }
    }

    for _ in 0..(backslashes * 2) {
        out.push('\\');
    }
    out.push('"');
    out
}

#[cfg(windows)]
fn run_injector_from_memory_with_args_and_saved_login(
    exe_bytes: &[u8],
    target_pid: u32,
    config: &str,
    token: &str,
    saved_login_b64: &str,
) -> Result<(), String> {
    let is_64bit = {
        if exe_bytes.len() < mem::size_of::<IMAGE_DOS_HEADER>() {
            return Err("Invalid PE file: too small".to_string());
        }
        let dos = unsafe { &*(exe_bytes.as_ptr() as *const IMAGE_DOS_HEADER) };
        let nt_off = dos.e_lfanew as usize;
        if exe_bytes.len() < nt_off + 26 {
            return Err("Invalid PE file: too small for NT headers".to_string());
        }
        u16::from_le_bytes([exe_bytes[nt_off + 24], exe_bytes[nt_off + 25]]) == 0x020B
    };

    let exe_label = if is_64bit { "x64.exe" } else { "x86.exe" };
    let cmdline = format!(
        "{} {} {} {} {}",
        quote_windows_arg(exe_label),
        target_pid,
        quote_windows_arg(config),
        quote_windows_arg(token),
        quote_windows_arg(saved_login_b64)
    );

    let mut cmdline_buf: Vec<u16> = cmdline.encode_utf16().chain(Some(0)).collect();

    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let app_name_path = if is_64bit {
        format!("{}\\System32\\cmd.exe", system_root)
    } else {
        format!("{}\\SysWOW64\\cmd.exe", system_root)
    };

    let app_name_w: Vec<u16> = app_name_path.encode_utf16().chain(Some(0)).collect();

    unsafe {
        let mut si: STARTUPINFOW = mem::zeroed();
        si.cb = mem::size_of::<STARTUPINFOW>() as DWORD;
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE as u16;
        let mut pi: PROCESS_INFORMATION = mem::zeroed();

        let ok = CreateProcessW(
            app_name_w.as_ptr(),
            cmdline_buf.as_mut_ptr(),
            null_mut(), null_mut(),
            0, CREATE_SUSPENDED | CREATE_NO_WINDOW,
            null_mut(), null_mut(),
            &mut si, &mut pi,
        );
        if ok == 0 {
            return Err(format!("Failed to create host process: {}", std::io::Error::last_os_error()));
        }

        let h_proc = pi.hProcess;
        let h_thread = pi.hThread;

        let result = if is_64bit {
            hollow_process_x64(exe_bytes, h_proc, h_thread)
        } else {
            hollow_process_with_pe(exe_bytes, h_proc, h_thread)
        };

        match result {
            Ok(()) => {
                ResumeThread(h_thread);
                CloseHandle(h_thread);
                CloseHandle(h_proc);
                Ok(())
            }
            Err(e) => {
                TerminateProcess(h_proc, 1);
                CloseHandle(h_thread);
                CloseHandle(h_proc);
                Err(e)
            }
        }
    }
}

#[tauri::command]
async fn launch_trove_saved(
    details_b64: String,
    trove_path: Option<String>,
    region: Option<String>,
) -> Result<u32, String> {
    let region_str = region.unwrap_or_else(|| "EU".to_string());
    let trove_exe = resolve_trove_x64_exe_path_for_region(trove_path.as_deref(), &region_str)?;
    let auth_servers = get_auth_server_args(&region_str);
    tokio::task::spawn_blocking(move || {
        trove_launcher::launch_trove_ipc(&trove_exe, &details_b64, &auth_servers)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn glyph_login_account(request: GlyphLoginRequest) -> Result<GlyphLoginResult, String> {
    login_account_and_store(request).await
}

#[tauri::command]
async fn glyph_touch_account(details_b64: String) -> Result<GlyphLoginResult, String> {
    touch_account_saved(details_b64).await
}

#[tauri::command]
async fn glyph_resend_auth_code(email: String) -> Result<u16, String> {
    use reqwest::Client;
    use std::collections::HashMap;
    let url = "https://auth.trionworlds.com/resendCode";
    let mut form = HashMap::new();
    form.insert("username", email.trim().to_string());
    let resp = Client::new()
        .post(url)
        .header("User-Agent", glyph_login_helper::DEFAULT_USER_AGENT)
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.status().as_u16())
}

#[tauri::command]
fn check_file_exists(path: String) -> bool {
    std::path::Path::new(path.trim()).is_file()
}

#[tauri::command]
fn resolve_trove_exe_path_cmd(trove_path_override: Option<String>) -> Result<String, String> {
    resolve_trove_exe_path(trove_path_override.as_deref())
}

#[tauri::command]
fn resolve_trove_pts_exe_path_cmd() -> Result<String, String> {
    resolve_trove_x64_exe_path_for_region(None, "PTS")
}

#[tauri::command]
fn is_pid_running(pid: u32) -> bool {
    let mut sys = System::new();
    sys.refresh_processes();
    sys.process(sysinfo::Pid::from_u32(pid)).is_some()
}

#[tauri::command]
fn inspect_trove_executable_cmd(path: String) -> Result<TroveExecutableInfo, String> {
    let normalized = path.trim().to_string();
    if normalized.is_empty() {
        return Err("Executable path is empty".to_string());
    }

    let p = std::path::Path::new(&normalized);
    if !p.is_file() {
        return Err(format!("Executable does not exist: {}", normalized));
    }

    let file_name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let lower_name = file_name.to_ascii_lowercase();
    let is_supported_name = lower_name == "trove_x64.exe";

    let is_exe_extension = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);

    let normalized_lower = normalized.replace('/', "\\").to_ascii_lowercase();
    let is_expected_dir = normalized_lower.contains("\\glyph\\games\\trove\\live\\")
        || normalized_lower.contains("\\glyph\\games\\trove\\pts\\");
    let is_live = normalized_lower.contains("\\glyph\\games\\trove\\live\\");
    let is_pts = normalized_lower.contains("\\glyph\\games\\trove\\pts\\");

    let size_bytes = std::fs::metadata(p).map_err(|e| e.to_string())?.len();
    let is_min_size = size_bytes > 20 * 1024 * 1024;
    let is_valid_for_glyph = is_exe_extension && is_supported_name && is_expected_dir && is_min_size;

    let message = if is_valid_for_glyph {
        "".to_string()
    } else {
        "Incompatible file".to_string()
    };

    Ok(TroveExecutableInfo {
        path: normalized,
        file_name,
        size_bytes,
        is_exe_extension,
        is_supported_name,
        is_expected_dir,
        is_valid_for_glyph,
        is_live,
        is_pts,
        message,
    })
}

fn resolve_injector_path(custom_path: Option<&str>) -> Result<Vec<u8>, String> {
    if let Some(path) = custom_path.map(str::trim).filter(|p| !p.is_empty()) {
        return std::fs::read(path).map_err(|_| format!("Injector-x64.exe not found at {}", path));
    }
    let injector_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Could not determine launcher directory")?
        .join("Injector-x64.exe");
    std::fs::read(&injector_path)
        .map_err(|_| format!("Injector-x64.exe not found at {}", injector_path.display()))
}

#[cfg(windows)]
#[tauri::command]
async fn launch_trove_and_inject_saved(
    state: tauri::State<'_, LauncherState>,
    details_b64: String,
    trove_path: Option<String>,
    account_email: Option<String>,
    enforce_single_instance: Option<bool>,
    region: Option<String>,
    injector_path: Option<String>,
) -> Result<u32, String> {
    if details_b64.trim().is_empty() {
        return Err("Missing saved login details (base64)".to_string());
    }

    let enforce_single = enforce_single_instance.unwrap_or(false);
    let normalized_email = account_email
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());
    let mut launch_guard_email: Option<String> = None;

    if enforce_single {
        if let Some(email) = normalized_email.clone() {
            let mut launching = state.launching_emails.lock().map_err(|e| e.to_string())?;
            if launching.contains(&email) {
                return Err("Account launch already in progress for this account.".to_string());
            }
            launching.insert(email.clone());
            launch_guard_email = Some(email);
        }
    }

    let setup = (|| -> Result<(Vec<u8>, String, String), String> {
        let exe_bytes = resolve_injector_path(injector_path.as_deref())?;
        let trove_exe = resolve_trove_x64_exe_path_for_region(trove_path.as_deref(), region.as_deref().unwrap_or("EU"))?;
        let auth_servers = get_auth_server_args(region.as_deref().unwrap_or("EU"));
        Ok((exe_bytes, trove_exe, auth_servers))
    })();

    let launch_result = match setup {
        Ok((exe_bytes, trove_exe, auth_servers)) => {
            tokio::task::spawn_blocking(move || -> Result<u32, String> {
                let trove_pid = trove_launcher::launch_trove_ipc(&trove_exe, &details_b64, &auth_servers)?;
                run_injector_from_memory_with_args_and_saved_login(
                    &exe_bytes,
                    trove_pid,
                    "",
                    "",
                    &details_b64,
                )?;
                Ok(trove_pid)
            })
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r)
        }
        Err(e) => Err(e),
    };

    if let Some(email) = launch_guard_email {
        if let Ok(mut launching) = state.launching_emails.lock() {
            launching.remove(&email);
        }
    }

    launch_result
}

#[cfg(not(windows))]
#[tauri::command]
async fn launch_trove_and_inject_saved(
    _state: tauri::State<'_, LauncherState>,
    _details_b64: String,
    _trove_path: Option<String>,
    _account_email: Option<String>,
    _enforce_single_instance: Option<bool>,
    _region: Option<String>,
    _injector_path: Option<String>,
) -> Result<u32, String> {
    Err("Trove launch and injection is only supported on Windows".to_string())
}

#[tauri::command]
fn relaunch_app() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::process::Command::new(exe).spawn();
    }
    std::process::exit(0);
}

#[tauri::command]
fn read_pd_file() -> Result<String, String> {
    let path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or_else(|| "Could not resolve exe directory".to_string())?
        .join("session.pd");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_pd_file(content: String) -> Result<(), String> {
    let dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or_else(|| "Could not resolve exe directory".to_string())?
        .to_path_buf();
    fs::write(dir.join("session.pd"), content).map_err(|e| e.to_string())
}

#[cfg(windows)]
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    use winapi::um::shellapi::ShellExecuteW;
    use winapi::um::winuser::SW_SHOWNORMAL;
    let url_wide: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    let verb_wide: Vec<u16> = "open\0".encode_utf16().collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb_wide.as_ptr(),
            url_wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL as i32,
        )
    };
    if result as usize <= 32 {
        return Err(format!("ShellExecuteW failed: {}", result as usize));
    }
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn kill_process(pid: u32) -> Result<(), String> {
    let mut system = System::new_all();
    system.refresh_processes();

    let sysinfo_pid = sysinfo::Pid::from_u32(pid);

    if let Some(process) = system.process(sysinfo_pid) {
        if process.kill() {
            Ok(())
        } else {
            Err("Failed to kill process".to_string())
        }
    } else {
        Err("Process not found".to_string())
    }
}

#[tauri::command]
fn get_trove_processes() -> Result<Vec<ProcessInfo>, String> {
    let mut system = System::new_all();
    system.refresh_processes();

    let processes: Vec<ProcessInfo> = system
        .processes()
        .iter()
        .filter(|(_, process)| {
            let name = process.name().to_lowercase();
            name.contains("trove") && name.ends_with(".exe")
        })
        .map(|(pid, process)| ProcessInfo {
            pid: pid.as_u32(),
            name: process.name().to_string(),
            exe_path: process
                .exe()
                .and_then(|p| p.to_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect();

    Ok(processes)
}

#[tauri::command]
async fn end_game_session() -> Result<(), String> {
    let mut system = System::new_all();
    system.refresh_processes();
    for (_, process) in system.processes() {
        let name = process.name().to_lowercase();
        if name.contains("trove") && name.ends_with(".exe") {
            process.kill();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
      }
    }))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(not(debug_assertions))]
      {
        let apply_security = |wv: tauri::webview::PlatformWebview| unsafe {
          if let Ok(wv2) = wv.controller().CoreWebView2() {
            if let Ok(s) = wv2.Settings() {
              let _ = s.SetAreDevToolsEnabled(false);
              let _ = s.SetAreDefaultContextMenusEnabled(false);
            }
          }
        };
        if let Some(win) = app.get_webview_window("main") {
          let _ = win.with_webview(apply_security);
        }
        let app_handle2 = app.handle().clone();
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_millis(500));
          if let Some(win) = app_handle2.get_webview_window("main") {
            let _ = win.with_webview(|wv| unsafe {
              if let Ok(wv2) = wv.controller().CoreWebView2() {
                if let Ok(s) = wv2.Settings() {
                  let _ = s.SetAreDevToolsEnabled(false);
                  let _ = s.SetAreDefaultContextMenusEnabled(false);
                }
              }
            });
          }
        });
      }
      Ok(())
    })
    .manage(LauncherState::new())
    .manage(UpdaterState::new())
    .invoke_handler(tauri::generate_handler![
      get_trove_processes,
      glyph_login_account,
      check_file_exists,
      resolve_trove_exe_path_cmd,
      resolve_trove_pts_exe_path_cmd,
      check_trove_update,
      download_trove_fresh,
      cancel_trove_update,
      pause_trove_update,
      resume_trove_update,
      has_local_manifest,
      apply_trove_update,
      inspect_trove_executable_cmd,
      launch_trove_and_inject_saved,
      launch_trove_saved,
      kill_process,
      end_game_session,
      open_url,
      relaunch_app,
      read_pd_file,
      write_pd_file,
      glyph_resend_auth_code,
      glyph_touch_account,
      is_pid_running,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
