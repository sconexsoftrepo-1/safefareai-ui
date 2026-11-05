/**
 * The app's entry point. It renders nothing: RouteGuard sends the user to their own default once authentication and
 * permissions have loaded (landingRedirect). A server redirect here couldn't know who is signing in.
 */
export default function DriveVisionIndex() {
  return null;
}
