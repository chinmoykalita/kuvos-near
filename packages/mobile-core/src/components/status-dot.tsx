import { View } from "react-native";

export function StatusDot({
  status = "scheduled",
  size = 8
}: {
  status?: "scheduled" | "done" | "skipped" | "missed" | "current";
  size?: number;
}) {
  const getStyle = () => {
    switch (status) {
      case "current":
        return "bg-fresh-green";
      case "done":
        return "bg-fresh-green";
      case "skipped":
        return "bg-sun";
      case "missed":
        return "bg-coral";
      case "scheduled":
      default:
        return "border-2 border-slate bg-transparent";
    }
  };

  return (
    <View
      className={`rounded-full ${getStyle()}`}
      style={{ width: size, height: size }}
    />
  );
}
