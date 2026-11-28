// Protect URL paths, query strings and bearer credentials with current-user DPAPI.
use reqwest::{header::HeaderValue, Url};
use serde::{Deserialize, Serialize};
use std::{net::IpAddr, ptr, slice};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};

#[derive(Serialize, Deserialize)]
pub(super) struct Target {
    pub url: String,
    pub token: String,
    // Kept inside DPAPI so the database fingerprint cannot be used to guess a secret URL.
    pub fingerprint_salt: [u8; 16],
}

impl Target {
    pub fn validate(&self) -> Result<Url, String> {
        let bad = "Enter an HTTPS URL, or use HTTP with a numeric loopback address.";
        let url = Url::parse(&self.url).map_err(|_| bad)?;
        let loopback = url
            .host_str()
            .and_then(|host| host.trim_matches(['[', ']']).parse::<IpAddr>().ok())
            .is_some_and(|ip| ip.is_loopback());
        if self.url.len() > 8192
            || url.host().is_none()
            || !(url.scheme() == "https" || url.scheme() == "http" && loopback)
        {
            return Err(bad.into());
        }
        if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
            return Err("Remove URL user information and fragments. Use the bearer token field for authentication.".into());
        }
        if self.token.len() > 8192
            || self.token.chars().any(char::is_whitespace)
            || HeaderValue::from_str(&self.token).is_err()
        {
            return Err("Enter a bearer token without whitespace or control characters.".into());
        }
        Ok(url)
    }

    pub fn seal(&self) -> Result<Vec<u8>, String> {
        let data =
            serde_json::to_vec(self).map_err(|_| "Could not encode the webhook destination.")?;
        dpapi(&data, true)
    }

    pub fn open(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(&dpapi(bytes, false)?)
            .map_err(|_| "Could not read the protected webhook destination.".into())
    }
}

fn dpapi(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(data.len()).map_err(|_| "Webhook settings are too large.")?,
        pbData: data.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    // Both calls borrow the input and allocate the output with LocalAlloc.
    unsafe {
        let ok = if protect {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(
                "Windows could not access the webhook credentials for this user account.".into(),
            );
        }
        let bytes = slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData.cast());
        Ok(bytes)
    }
}
