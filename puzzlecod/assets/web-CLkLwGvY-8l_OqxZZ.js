// Capacitor NetworkWeb Implementation for Web Browser
export class NetworkWeb {
  constructor() {
    this.listeners = {};
    this.handleOnline = () => {
      const status = { connected: true, connectionType: this.getConnectionType() };
      this.notifyListeners("networkStatusChange", status);
    };
    this.handleOffline = () => {
      const status = { connected: false, connectionType: "none" };
      this.notifyListeners("networkStatusChange", status);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }
  getConnectionType() {
    if (typeof navigator === "undefined") return "unknown";
    const nav = navigator;
    const c = nav.connection || nav.mozConnection || nav.webkitConnection;
    return c ? (c.type || c.effectiveType || "wifi") : "wifi";
  }
  async getStatus() {
    const isOnline = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true;
    return {
      connected: isOnline,
      connectionType: isOnline ? this.getConnectionType() : "none"
    };
  }
  notifyListeners(eventName, data) {
    const list = this.listeners[eventName] || [];
    list.forEach(fn => {
      try { fn(data); } catch (e) { console.warn(e); }
    });
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
export default NetworkWeb;
