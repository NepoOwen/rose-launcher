use base64::{engine::general_purpose::STANDARD, Engine};

const RIFT_MAGIC: u32 = 0x52494654;

fn rc4(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut s: Vec<u8> = (0..=255u8).collect();
    let mut j: usize = 0;
    for i in 0..256 {
        j = (j + s[i] as usize + key[i % key.len()] as usize) % 256;
        s.swap(i, j);
    }
    let mut i = 0usize;
    let mut j = 0usize;
    let mut out = Vec::with_capacity(data.len());
    for &byte in data {
        i = (i + 1) % 256;
        j = (j + s[i] as usize) % 256;
        s.swap(i, j);
        out.push(byte ^ s[(s[i] as usize + s[j] as usize) % 256]);
    }
    out
}

fn build_ipc_buffer(ticket: &str) -> ([u8; 8], Vec<u8>) {
    let ticket_bytes = ticket.as_bytes();
    let mut plaintext = Vec::with_capacity(4 + ticket_bytes.len() + 1);
    plaintext.extend_from_slice(&RIFT_MAGIC.to_le_bytes());
    plaintext.extend_from_slice(ticket_bytes);
    plaintext.push(0u8);

    use rand::RngCore;
    let mut rc_key = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut rc_key);

    let encrypted = rc4(&rc_key, &plaintext);
    let enc_len = encrypted.len() as u32;

    let mut buf = Vec::with_capacity(8 + 4 + encrypted.len());
    buf.extend_from_slice(&rc_key);
    buf.extend_from_slice(&enc_len.to_le_bytes());
    buf.extend_from_slice(&encrypted);

    (rc_key, buf)
}

fn clean_ticket(raw: &str) -> String {
    let trimmed = raw.trim();
    let lines: Vec<&str> = trimmed.split('\n').collect();
    let start = lines
        .iter()
        .position(|l| {
            let t = l.trim();
            t.starts_with("Signature:") || t.starts_with("<?xml")
        })
        .unwrap_or(0);
    lines[start..].join("\n").trim().to_string()
}

#[cfg(windows)]
pub fn launch_trove_ipc(
    trove_exe: &str,
    details_b64: &str,
    auth_servers: &str,
) -> Result<u32, String> {
    use std::{mem, ptr};
    use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
    use winapi::um::memoryapi::{CreateFileMappingW, MapViewOfFile, UnmapViewOfFile, FILE_MAP_WRITE};
    use winapi::um::minwinbase::SECURITY_ATTRIBUTES;
    use winapi::um::processthreadsapi::{
        CreateProcessW, GetCurrentProcessId, TerminateProcess, PROCESS_INFORMATION, STARTUPINFOW,
    };
    use winapi::um::synchapi::{CreateEventW, WaitForSingleObject};
    use winapi::um::winbase::WAIT_OBJECT_0;
    use winapi::um::winnt::PAGE_READWRITE;

    let raw_bytes = STANDARD
        .decode(details_b64.trim())
        .map_err(|e| format!("Failed to decode details_b64: {}", e))?;
    let raw_text = String::from_utf8_lossy(&raw_bytes);
    let ticket = clean_ticket(raw_text.as_ref());

    let (_rc_key, buf) = build_ipc_buffer(&ticket);
    let buf_size = buf.len() as u32;

    unsafe {
        let mut sa: SECURITY_ATTRIBUTES = mem::zeroed();
        sa.nLength = mem::size_of::<SECURITY_ATTRIBUTES>() as u32;
        sa.bInheritHandle = 1;
        sa.lpSecurityDescriptor = ptr::null_mut();

        let h_map = CreateFileMappingW(
            INVALID_HANDLE_VALUE,
            &mut sa,
            PAGE_READWRITE,
            0,
            buf_size,
            ptr::null(),
        );
        if h_map.is_null() {
            return Err(format!(
                "CreateFileMappingW failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let p_view = MapViewOfFile(h_map, FILE_MAP_WRITE, 0, 0, buf_size as usize);
        if p_view.is_null() {
            CloseHandle(h_map);
            return Err(format!(
                "MapViewOfFile failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        ptr::copy_nonoverlapping(buf.as_ptr(), p_view as *mut u8, buf.len());
        UnmapViewOfFile(p_view);

        let h_event = CreateEventW(
            &mut sa,
            0,
            0,
            ptr::null(),
        );
        if h_event.is_null() {
            CloseHandle(h_map);
            return Err(format!(
                "CreateEventW failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let launcher_pid = GetCurrentProcessId();
        let map_val = h_map as u64;
        let evt_val = h_event as u64;
        let cmd = format!(
            "\"{}\" -k {:X}:{:X}:{} -C \"[AuthServer] Address = {}\"",
            trove_exe, map_val, evt_val, launcher_pid, auth_servers
        );

        let mut cmd_wide: Vec<u16> = cmd.encode_utf16().chain(Some(0u16)).collect();

        let work_dir = std::path::Path::new(trove_exe)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let work_dir_wide: Vec<u16> = work_dir.encode_utf16().chain(Some(0u16)).collect();

        let mut si: STARTUPINFOW = mem::zeroed();
        si.cb = mem::size_of::<STARTUPINFOW>() as u32;
        let mut pi: PROCESS_INFORMATION = mem::zeroed();

        let ok = CreateProcessW(
            ptr::null(),
            cmd_wide.as_mut_ptr(),
            ptr::null_mut(),
            ptr::null_mut(),
            1,
            0,
            ptr::null_mut(),
            work_dir_wide.as_ptr(),
            &mut si,
            &mut pi,
        );

        if ok == 0 {
            CloseHandle(h_event);
            CloseHandle(h_map);
            return Err(format!(
                "CreateProcessW failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let pid = pi.dwProcessId;

        let wait = WaitForSingleObject(h_event, 30_000);
        if wait != WAIT_OBJECT_0 {
            TerminateProcess(pi.hProcess, 1);
        }

        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        CloseHandle(h_event);
        CloseHandle(h_map);

        Ok(pid)
    }
}

#[cfg(not(windows))]
pub fn launch_trove_ipc(
    _trove_exe: &str,
    _details_b64: &str,
    _auth_servers: &str,
) -> Result<u32, String> {
    Err("Trove IPC launch is only supported on Windows".to_string())
}
