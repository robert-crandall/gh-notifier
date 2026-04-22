import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronApi, IpcChannelName, IpcChannels } from '../shared/ipc-channels'

const api: ElectronApi = {
  ipc: {
    invoke<C extends IpcChannelName>(
      channel: C,
      ...args: IpcChannels[C]['args']
    ): Promise<IpcChannels[C]['result']> {
      return ipcRenderer.invoke(channel, ...args) as Promise<IpcChannels[C]['result']>
    }
  },
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  onNotificationsUpdated: (callback: () => void) => {
    ipcRenderer.on('notifications:updated', () => callback())
    return () => { ipcRenderer.removeAllListeners('notifications:updated') }
  }
}

contextBridge.exposeInMainWorld('electron', api)
