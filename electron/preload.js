const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getEnvironment() {
    return ipcRenderer.invoke('environment:get');
  },
  chooseWorkspace() {
    return ipcRenderer.invoke('workspace:choose');
  },
  listProjects() {
    return ipcRenderer.invoke('projects:list');
  },
  runScript(payload) {
    return ipcRenderer.invoke('scripts:run', payload);
  },
  onScriptLog(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('script:log', handler);

    return () => {
      ipcRenderer.removeListener('script:log', handler);
    };
  },
});
