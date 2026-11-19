/** Client-side announcement list paging for the lobby panel. */
export const ANN_PAGE_SIZE = 5;

/** @param {number} itemCount */
export function announcementPageCount(itemCount, pageSize = ANN_PAGE_SIZE) {
    const n = Math.max(0, Number(itemCount) || 0);
    const size = Math.max(1, Number(pageSize) || ANN_PAGE_SIZE);
    return n === 0 ? 0 : Math.ceil(n / size);
}

/**
 * @param {readonly unknown[]} items
 * @param {number} pageIndex zero-based
 */
export function announcementPageSlice(items, pageIndex, pageSize = ANN_PAGE_SIZE) {
    const list = Array.isArray(items) ? items : [];
    const pages = announcementPageCount(list.length, pageSize);
    if (!pages) return { pageIndex: 0, pageCount: 0, slice: [] };
    const size = Math.max(1, Number(pageSize) || ANN_PAGE_SIZE);
    let page = Math.floor(Number(pageIndex) || 0);
    if (page < 0) page = 0;
    if (page >= pages) page = pages - 1;
    const start = page * size;
    return { pageIndex: page, pageCount: pages, slice: list.slice(start, start + size) };
}

/** @param {number} pageIndex @param {number} pageCount */
export function clampAnnouncementPage(pageIndex, pageCount) {
    const pages = Math.max(0, Number(pageCount) || 0);
    if (!pages) return 0;
    let page = Math.floor(Number(pageIndex) || 0);
    if (page < 0) page = 0;
    if (page >= pages) page = pages - 1;
    return page;
}