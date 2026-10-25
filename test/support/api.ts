// Answers in the shapes the capture API really sends with response_type=json
// (API/Request.pm _build_legacy_payload), and nothing else: the tests never
// contact Site-Shot.

/** screenshot_parameters as the API echoes them; the url carries the target's query. */
function screenshotParameters(url: string, width: number, height: number) {
  return {
    format: "png",
    request_headers: [],
    language: "en",
    max_height: 20000,
    country: null,
    response_type: "json",
    width,
    geolocation: "40.7128,-74.0060",
    no_ads: 0,
    webgl: 0,
    height,
    version: 1,
    timeout: 60000,
    javascript_code: null,
    proxy_rotation: "0",
    time_zone: "America/New_York",
    url,
    delay_time: 500,
    no_cookie_popup: 0,
    scaled_width: width,
    source_code: 0,
    resolve_captcha: 0,
    full_size: "0",
    ready_variable: false,
    zoom: 100,
    user_agent: null,
    http_referer: null,
  };
}

/** A successful capture: HTTP 200 and the PNG as a data URL. */
export function captured(png: Buffer, url: string, width = 1024, height = 768) {
  return {
    screenshot_parameters: screenshotParameters(url, width, height),
    response: { status_code: 200, headers: [] },
    image: `data:image/png;base64,${png.toString("base64")}`,
  };
}

/**
 * A failure during the capture: also HTTP 200, with `error` and a placeholder
 * error image that is itself a valid PNG.
 */
export function failedCapture(error: string, internalStatus: number, placeholder: Buffer, url: string) {
  return {
    ...captured(placeholder, url),
    response: { status_code: internalStatus, headers: [] },
    error,
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
