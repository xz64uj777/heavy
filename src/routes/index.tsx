import { createFileRoute } from "@tanstack/react-router";
import { LaunchSim } from "@/components/LaunchSim";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <LaunchSim />;
}
