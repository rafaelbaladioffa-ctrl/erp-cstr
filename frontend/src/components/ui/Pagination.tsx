import Icon from "./Icon";

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="pagination-bar">
      <span>
        {total === 0 ? "Nenhum registro" : `Exibindo ${start}–${end} de ${total}`}
      </span>
      <div className="pagination-controls">
        <button
          className="pagination-page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Página anterior"
        >
          <Icon name="chevron_left" style={{ fontSize: 16 }} />
        </button>
        <button className="pagination-page active">{page}</button>
        <button
          className="pagination-page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Próxima página"
        >
          <Icon name="chevron_right" style={{ fontSize: 16 }} />
        </button>
        <select
          className="select"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{ marginLeft: 8, padding: "6px 8px", fontSize: 12.5 }}
        >
          {[10, 25, 50].map((size) => (
            <option key={size} value={size}>
              {size} por página
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
