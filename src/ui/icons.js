import {
  Scan,
  FileText,
  ShoppingBasket,
  SlidersHorizontal,
  History,
  ChevronDown,
  ChevronLeft,
  X,
  Check,
  Star,
  Bookmark,
  Send,
  PanelsTopLeft,
  MousePointer2,
  MessageSquare,
  Plus,
  CirclePlus,
  RefreshCw,
  Download,
  Crop,
  RectangleHorizontal,
  ArrowUpRight,
  Undo2,
  Search,
  PanelRight,
  Monitor,
  MoveVertical,
  Video,
  NotebookPen,
  FileSearch,
  FilePlus2,
  Command,
  ArrowBigUp,
  Option,
} from 'lucide';

// Only official Lucide nodes are serialized; the API remains usable in string templates.
const icons = {
  capture: Scan,
  viewport: Monitor,
  fullpage: MoveVertical,
  video: Video,
  drafts: NotebookPen,
  preview: FileSearch,
  upload: FilePlus2,
  command: Command,
  shift: ArrowBigUp,
  option: Option,
  page: FileText,
  basket: ShoppingBasket,
  settings: SlidersHorizontal,
  history: History,
  chevron: ChevronDown,
  back: ChevronLeft,
  close: X,
  check: Check,
  star: Star,
  bookmark: Bookmark,
  send: Send,
  tabs: PanelsTopLeft,
  element: MousePointer2,
  reply: MessageSquare,
  plus: Plus,
  'circle-plus': CirclePlus,
  refresh: RefreshCw,
  download: Download,
  crop: Crop,
  redact: RectangleHorizontal,
  arrow: ArrowUpRight,
  undo: Undo2,
  file: FileText,
  search: Search,
  panel: PanelRight,
};
export function icon(name, size = 20) {
  const nodes = icons[name] ?? FileText;
  const children = nodes
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([key, value]) => `${key}="${value}"`)
          .join(' ')}/>`,
    )
    .join('');
  return `<svg class="lucide" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}
