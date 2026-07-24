export function calculatePagination(totalItems, pageSize, requestedPage) {
  const safeTotal = Math.max(0, Number(totalItems) || 0);
  const safePageSize = Math.max(1, Number(pageSize) || 20);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Number(requestedPage) || 1));
  const startIndex = (currentPage - 1) * safePageSize;
  return {
    totalItems: safeTotal,
    pageSize: safePageSize,
    totalPages,
    currentPage,
    startIndex,
    endIndex: Math.min(safeTotal, startIndex + safePageSize)
  };
}

export function visiblePageNumbers(currentPage, totalPages, maximum = 5) {
  const count = Math.min(Math.max(1, maximum), totalPages);
  let start = Math.max(1, currentPage - Math.floor(count / 2));
  start = Math.min(start, Math.max(1, totalPages - count + 1));
  return Array.from({ length: count }, (_, index) => start + index);
}
