import { RootRedirect } from "@/components/drive-vision/auth/root-redirect";

/** Entry point: opens /drive-vision on the client (static-export compatible), which then lands each user on their own default screen. */
export default function Home() {
  return <RootRedirect />;
}
