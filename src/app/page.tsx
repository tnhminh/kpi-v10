import AppGateway from "@/components/app-gateway";
import { AppProviders } from "@/components/providers";

export default function Home() {
  return <AppProviders><AppGateway/></AppProviders>;
}
