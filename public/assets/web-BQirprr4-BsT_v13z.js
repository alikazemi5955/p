// Capacitor AppWeb Implementation for Web Browser
export class AppWeb {
  constructor() {
    this.listeners = {};
    this.handleVisibility = () => {
      const isActive = typeof document !== "undefined" ? !document.hidden : true;
      this.notifyListeners("appStateChange", { isActive });
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibility);
    }
  }
  notifyListeners(eventName, data) {
    const list = this.listeners[eventName] || [];
    list.forEach(fn => {
      try { fn(data); } catch (e) { console.warn(e); }
    });
  }
  async exitApp() {
    // No-op in browser
    return;
  }
  async getInfo() {
    return { name: "پازل کالا", id: "ir.puzzlekala.app", build: "1.0", version: "1.0.0" };
  }
  async getState() {
    return { isActive: typeof document !== "undefined" ? !document.hidden : true };
  }
  async getLaunchUrl() {
    return { url: typeof window !== "undefined" ? window.location.href : "" };
  }
  async addListener(eventName, listenerFunc) {
    if (!this.listeners[eventName]) this.listeners[eventName] = [];
    this.listeners[eventName].push(listenerFunc);
    return {
      remove: async () => {
        this.listeners[eventName] = (this.listeners[eventName] || []).filter(fn => fn !== listenerFunc);
      }
    };
  }
  async removeAllListeners() {
    this.listeners = {};
  }
}
export default AppWeb;
