/**
 * Redirect-only index. It renders nothing: once authentication and permissions have loaded, RouteGuard
 * sends /drive-vision/devices to Device commands (landingRedirect), where that screen's own grant is
 * checked. A client-side redirect, so the page can be exported as a static file.
 */
export default function DevicesIndex() {
  return null;
}
