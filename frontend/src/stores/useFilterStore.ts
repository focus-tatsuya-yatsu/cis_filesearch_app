/**
 * フィルタ状態管理ストア
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Server {
  id: string
  name: string
  description?: string
  isSelected: boolean
}

export interface Folder {
  id: string
  name: string
  serverId: string
  isSelected: boolean
}

export interface DateRangeFilter {
  startDate: string | null
  endDate: string | null
  filterType: 'creation' | 'modification'
}

export type FileTypeFilter = 'all' | 'pdf' | 'xlsx' | 'docx' | 'pptx' | 'xdw' | 'image' | 'other'

interface FilterStore {
  servers: Server[]
  selectedServerIds: string[]
  folders: Folder[]
  selectedFolderIds: string[]
  dateRange: DateRangeFilter
  fileType: FileTypeFilter
  isInitialized: boolean

  initializeServers: (servers: Server[]) => void
  initializeFolders: (folders: Folder[]) => void
  toggleServer: (serverId: string) => void
  toggleFolder: (folderId: string) => void
  selectAllServers: () => void
  deselectAllServers: () => void
  selectAllFoldersInServer: (serverId: string) => void
  deselectAllFoldersInServer: (serverId: string) => void
  setDateRange: (dateRange: DateRangeFilter) => void
  setFileType: (fileType: FileTypeFilter) => void
  resetFilters: () => void

  getSelectedServers: () => Server[]
  getSelectedFolders: () => Folder[]
  getFoldersForServer: (serverId: string) => Folder[]
  hasActiveFilters: () => boolean
}

const TOP_FOLDERS = [
  'H22_JOB',
  'H23_JOB',
  'H24_JOB',
  'H25_JOB',
  'H26_JOB',
  'H27_JOB',
  'H28_JOB',
  'H29_JOB',
  'H30_JOB',
  'H31_JOB',
  'R01_JOB',
  'R02_JOB',
  'R03_JOB',
  'R04_JOB',
  'R05_JOB',
  'R06_JOB',
  'その他',
]

// 初期カテゴリデータ
const INITIAL_SERVERS: Server[] = [
  { id: 'road', name: '道路', description: 'ts-server3(R:), ts-server5(U:)', isSelected: false },
  {
    id: 'structure',
    name: '構造',
    description: 'ts-server6(V:), ts-server7(S:)',
    isSelected: false,
  },
]

// 初期フォルダデータを生成
const generateInitialFolders = (): Folder[] => {
  const folders: Folder[] = []
  INITIAL_SERVERS.forEach((server) => {
    TOP_FOLDERS.forEach((folderName) => {
      folders.push({
        id: `${server.id}_${folderName}`,
        name: folderName,
        serverId: server.id,
        isSelected: false,
      })
    })
  })
  return folders
}

export const useFilterStore = create<FilterStore>()(
  persist(
    (set, get) => ({
      // 初期状態で既にデータをセット
      servers: INITIAL_SERVERS,
      selectedServerIds: [],
      folders: generateInitialFolders(),
      selectedFolderIds: [],
      dateRange: {
        startDate: null,
        endDate: null,
        filterType: 'creation',
      },
      fileType: 'all',
      isInitialized: true,

      initializeServers: (servers) => {
        set({ servers })
      },

      initializeFolders: (folders) => {
        set({ folders })
      },

      toggleServer: (serverId) => {
        const state = get()
        const isCurrentlySelected = state.selectedServerIds.includes(serverId)

        if (isCurrentlySelected) {
          const serverFolders = state.folders.filter((f) => f.serverId === serverId)
          const folderIdsToRemove = serverFolders.map((f) => f.id)

          set({
            selectedServerIds: state.selectedServerIds.filter((id) => id !== serverId),
            selectedFolderIds: state.selectedFolderIds.filter(
              (id) => !folderIdsToRemove.includes(id)
            ),
            servers: state.servers.map((s) =>
              s.id === serverId ? { ...s, isSelected: false } : s
            ),
            folders: state.folders.map((f) =>
              f.serverId === serverId ? { ...f, isSelected: false } : f
            ),
          })
        } else {
          set({
            selectedServerIds: [...state.selectedServerIds, serverId],
            servers: state.servers.map((s) => (s.id === serverId ? { ...s, isSelected: true } : s)),
          })
        }
      },

      toggleFolder: (folderId) => {
        const state = get()
        const folder = state.folders.find((f) => f.id === folderId)
        if (!folder) return

        const isCurrentlySelected = state.selectedFolderIds.includes(folderId)

        if (isCurrentlySelected) {
          set({
            selectedFolderIds: state.selectedFolderIds.filter((id) => id !== folderId),
            folders: state.folders.map((f) =>
              f.id === folderId ? { ...f, isSelected: false } : f
            ),
          })
        } else {
          set({
            selectedFolderIds: [...state.selectedFolderIds, folderId],
            folders: state.folders.map((f) => (f.id === folderId ? { ...f, isSelected: true } : f)),
          })
        }
      },

      selectAllServers: () => {
        const state = get()
        set({
          selectedServerIds: state.servers.map((s) => s.id),
          servers: state.servers.map((s) => ({ ...s, isSelected: true })),
        })
      },

      deselectAllServers: () => {
        const state = get()
        set({
          selectedServerIds: [],
          selectedFolderIds: [],
          servers: state.servers.map((s) => ({ ...s, isSelected: false })),
          folders: state.folders.map((f) => ({ ...f, isSelected: false })),
        })
      },

      selectAllFoldersInServer: (serverId) => {
        const state = get()
        const serverFolders = state.folders.filter((f) => f.serverId === serverId)
        const folderIds = serverFolders.map((f) => f.id)

        set({
          selectedFolderIds: Array.from(new Set([...state.selectedFolderIds, ...folderIds])),
          selectedServerIds: Array.from(new Set([...state.selectedServerIds, serverId])),
          folders: state.folders.map((f) =>
            f.serverId === serverId ? { ...f, isSelected: true } : f
          ),
          servers: state.servers.map((s) => (s.id === serverId ? { ...s, isSelected: true } : s)),
        })
      },

      deselectAllFoldersInServer: (serverId) => {
        const state = get()
        const serverFolders = state.folders.filter((f) => f.serverId === serverId)
        const folderIds = serverFolders.map((f) => f.id)

        set({
          selectedFolderIds: state.selectedFolderIds.filter((id) => !folderIds.includes(id)),
          folders: state.folders.map((f) =>
            f.serverId === serverId ? { ...f, isSelected: false } : f
          ),
        })
      },

      setDateRange: (dateRange) => set({ dateRange }),

      setFileType: (fileType) => set({ fileType }),

      resetFilters: () => {
        const state = get()
        set({
          selectedServerIds: [],
          selectedFolderIds: [],
          servers: state.servers.map((s) => ({ ...s, isSelected: false })),
          folders: state.folders.map((f) => ({ ...f, isSelected: false })),
          dateRange: {
            startDate: null,
            endDate: null,
            filterType: 'creation',
          },
          fileType: 'all',
        })
      },

      getSelectedServers: () => {
        const state = get()
        return state.servers.filter((s) => state.selectedServerIds.includes(s.id))
      },

      getSelectedFolders: () => {
        const state = get()
        return state.folders.filter((f) => state.selectedFolderIds.includes(f.id))
      },

      getFoldersForServer: (serverId) => get().folders.filter((f) => f.serverId === serverId),

      hasActiveFilters: () => {
        const state = get()
        return (
          state.selectedServerIds.length > 0 ||
          state.selectedFolderIds.length > 0 ||
          state.dateRange.startDate !== null ||
          state.dateRange.endDate !== null ||
          state.fileType !== 'all'
        )
      },
    }),
    {
      name: 'filter-storage-v3', // 新しいキー名で古いキャッシュを無効化
      partialize: (state) => ({
        selectedServerIds: state.selectedServerIds,
        selectedFolderIds: state.selectedFolderIds,
        dateRange: state.dateRange,
        fileType: state.fileType,
      }),
    }
  )
)

// 後方互換性のためのエクスポート
export function generateSampleData() {
  return {
    servers: INITIAL_SERVERS,
    folders: generateInitialFolders(),
  }
}
