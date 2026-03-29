// HTTP-date parsing and formatting helpers for preview cache validators.
// Keeping this isolated makes the protocol flow easier to audit.

pub fn format_http_date_from_unix_seconds(total_seconds: i64) -> Option<String> {
    if total_seconds < 0 {
        return None;
    }
    let seconds_per_day = 86_400_i64;
    let days = total_seconds / seconds_per_day;
    let day_seconds = total_seconds % seconds_per_day;

    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;

    let (year, month, day) = civil_from_days(days)?;
    let month_name = month_name(month)?;
    let weekday_name = weekday_name(days)?;
    Some(format!(
        "{weekday_name}, {day:02} {month_name} {year:04} {hour:02}:{minute:02}:{second:02} GMT"
    ))
}

pub fn parse_http_date_seconds(value: &str) -> Result<i64, ()> {
    // IMF-fixdate: "Wed, 21 Oct 2015 07:28:00 GMT"
    let mut parts = value.split_whitespace();
    let weekday = parts.next().ok_or(())?;
    let day = parts.next().ok_or(())?;
    let month = parts.next().ok_or(())?;
    let year = parts.next().ok_or(())?;
    let time = parts.next().ok_or(())?;
    let zone = parts.next().ok_or(())?;
    if parts.next().is_some() {
        return Err(());
    }
    if !weekday.ends_with(',') || zone != "GMT" {
        return Err(());
    }

    let day: u32 = day.parse().map_err(|_| ())?;
    let month = month_number(month).ok_or(())?;
    let year: i32 = year.parse().map_err(|_| ())?;
    let (hour, minute, second) = parse_time_components(time).ok_or(())?;
    if hour > 23 || minute > 59 || second > 59 {
        return Err(());
    }

    let days = days_from_civil(year, month, day).ok_or(())?;
    let (check_year, check_month, check_day) = civil_from_days(days).ok_or(())?;
    if check_year != year || check_month != month || check_day != day {
        return Err(());
    }

    let total = days
        .checked_mul(86_400)
        .and_then(|value| value.checked_add(i64::from(hour) * 3_600))
        .and_then(|value| value.checked_add(i64::from(minute) * 60))
        .and_then(|value| value.checked_add(i64::from(second)))
        .ok_or(())?;
    if total < 0 {
        return Err(());
    }
    Ok(total)
}

fn parse_time_components(value: &str) -> Option<(u32, u32, u32)> {
    let mut split = value.split(':');
    let hour: u32 = split.next()?.parse().ok()?;
    let minute: u32 = split.next()?.parse().ok()?;
    let second: u32 = split.next()?.parse().ok()?;
    if split.next().is_some() {
        return None;
    }
    Some((hour, minute, second))
}

fn month_name(value: u32) -> Option<&'static str> {
    match value {
        1 => Some("Jan"),
        2 => Some("Feb"),
        3 => Some("Mar"),
        4 => Some("Apr"),
        5 => Some("May"),
        6 => Some("Jun"),
        7 => Some("Jul"),
        8 => Some("Aug"),
        9 => Some("Sep"),
        10 => Some("Oct"),
        11 => Some("Nov"),
        12 => Some("Dec"),
        _ => None,
    }
}

fn month_number(value: &str) -> Option<u32> {
    match value {
        "Jan" => Some(1),
        "Feb" => Some(2),
        "Mar" => Some(3),
        "Apr" => Some(4),
        "May" => Some(5),
        "Jun" => Some(6),
        "Jul" => Some(7),
        "Aug" => Some(8),
        "Sep" => Some(9),
        "Oct" => Some(10),
        "Nov" => Some(11),
        "Dec" => Some(12),
        _ => None,
    }
}

fn weekday_name(days_since_epoch: i64) -> Option<&'static str> {
    // 1970-01-01 was Thursday.
    let index = (days_since_epoch + 4).rem_euclid(7);
    match index {
        0 => Some("Sun"),
        1 => Some("Mon"),
        2 => Some("Tue"),
        3 => Some("Wed"),
        4 => Some("Thu"),
        5 => Some("Fri"),
        6 => Some("Sat"),
        _ => None,
    }
}

fn civil_from_days(days_since_epoch: i64) -> Option<(i32, u32, u32)> {
    let z = days_since_epoch.checked_add(719_468)?;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let month_prime = (5 * doy + 2) / 153;
    let day = doy - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    let year = i32::try_from(year).ok()?;
    let month = u32::try_from(month).ok()?;
    let day = u32::try_from(day).ok()?;
    Some((year, month, day))
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    if !(1..=12).contains(&month) || day == 0 || day > 31 {
        return None;
    }

    let mut year = i64::from(year);
    if month <= 2 {
        year -= 1;
    }
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month_prime = i64::from(month) + if month > 2 { -3 } else { 9 };
    let doy = (153 * month_prime + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}
