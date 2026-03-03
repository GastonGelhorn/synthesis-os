import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "@/context/AuthContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { ProfileProvider } from "@/context/ProfileContext";
import App from "@/App";
import "@/app/globals.css";

window.onerror = (msg, url, line, col, error) => {
  const div = document.createElement("div");
  div.style.cssText = "position:fixed;top:0;left:0;width:100%;height:50%;background:rgba(200,0,0,0.9);color:white;padding:20px;z-index:99999;overflow:auto;font-family:monospace;font-size:14px;";
  div.textContent = `RUNTIME ERROR:\n${String(msg)}\nAt: ${url}:${line}:${col}\n${error?.stack ?? ""}`;
  document.body.appendChild(div);
};
window.addEventListener("unhandledrejection", (event) => {
  const div = document.createElement("div");
  div.style.cssText = "position:fixed;top:50%;left:0;width:100%;height:50%;background:rgba(0,0,200,0.9);color:white;padding:20px;z-index:99999;overflow:auto;font-family:monospace;font-size:14px;";
  div.textContent = `UNHANDLED PROMISE REJECTION:\n${event.reason}`;
  document.body.appendChild(div);
});

function Root() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <ProfileProvider>
          <App />
        </ProfileProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
