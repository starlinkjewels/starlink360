import type { Product } from "@/data/products";

export function ProductList({
  products,
  activeId,
  onSelect,
}: {
  products: Product[];
  activeId: string;
  onSelect: (p: Product) => void;
}) {
  return (
    <nav aria-label="Collection" className="product-list">
      <p className="hidden text-[0.62rem] uppercase tracking-[0.3em] text-muted-foreground lg:block">
        Collection
      </p>
      <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        {products.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p)}
              aria-current={p.id === activeId}
              className={`product-card ${p.id === activeId ? "product-card-active" : ""}`}
            >
              <span className="font-serif text-base leading-tight">{p.name}</span>
              <span className="text-[0.6rem] uppercase tracking-[0.22em] text-muted-foreground">
                {p.ref}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
