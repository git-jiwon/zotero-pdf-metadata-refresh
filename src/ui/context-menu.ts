import { isRecognitionTarget } from '../utils/recognition-target';
import { uiText } from './i18n';
export interface MenuHandlers {
    open(): void;
}
export class ContextMenu {
    private nodes = new Map<Document, Element[]>();
    private listeners = new Map<Document, {
        popup: any;
        listener: () => void;
    }>();
    constructor(private handlers: MenuHandlers) { }
    register(win: any): void {
        const doc = win.document;
        const popup = doc.getElementById("zotero-itemmenu");
        if (!popup || this.nodes.has(doc))
            return;
        const create = (id: string, label: string, action: () => void) => {
            const node = doc.createXULElement("menuitem");
            node.id = id;
            node.setAttribute("label", uiText(label));
            node.addEventListener("command", action);
            popup.appendChild(node);
            return node;
        };
        const preview = create("pdf-metadata-refresh-preview", "PDF에서 제목·저자 정보 찾기…", () => this.handlers.open());
        const listener = () => {
            const selected = win.ZoteroPane.getSelectedItems();
            const supported = selected.some(isRecognitionTarget);
            preview.hidden = !supported;
        };
        popup.addEventListener("popupshowing", listener);
        this.listeners.set(doc, { popup, listener });
        this.nodes.set(doc, [preview]);
    }
    unregister(): void {
        for (const { popup, listener } of this.listeners.values())
            popup.removeEventListener("popupshowing", listener);
        this.listeners.clear();
        for (const nodes of this.nodes.values())
            for (const node of nodes)
                node.remove();
        this.nodes.clear();
    }
    unregisterWindow(win: any): void {
        const entry = this.listeners.get(win.document);
        if (entry)
            entry.popup.removeEventListener("popupshowing", entry.listener);
        this.listeners.delete(win.document);
        for (const node of this.nodes.get(win.document) || [])
            node.remove();
        this.nodes.delete(win.document);
    }
}
