import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "./style.css";
import { startEditor } from "./editor";
import { startPlay } from "./play";
import { isMuted, toggleMute } from "./sound";
import { startWatch } from "./watch";

const app = document.getElementById("app")!;
const hash = location.hash.slice(1);

if (hash.startsWith("p=")) {
  document.body.dataset.mode = "play";
  void startPlay(app, hash.slice(2));
} else if (hash.startsWith("g=")) {
  document.body.dataset.mode = "watch";
  void startWatch(app, hash.slice(2));
} else {
  document.body.dataset.mode = "edit";
  void startEditor(app);
}

// Each mode sets up its own listeners and loop, so a new link means a fresh page.
window.addEventListener("hashchange", () => location.reload());

const mute = document.getElementById("mute")!;
const showMute = () => {
  mute.textContent = isMuted() ? "sound off" : "sound on";
  mute.classList.toggle("off", isMuted());
};
mute.addEventListener("click", () => {
  toggleMute();
  showMute();
});
window.addEventListener("keydown", (e) => {
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  if (e.code === "KeyM") {
    toggleMute();
    showMute();
  }
});
showMute();
