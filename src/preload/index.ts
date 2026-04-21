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
  }
}

contextBridge.exposeInMainWorld('electron', api)
