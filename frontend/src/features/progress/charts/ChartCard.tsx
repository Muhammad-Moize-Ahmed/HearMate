import type { ReactNode } from 'react';

import { Swatch } from './Marker';
import type { SeriesStyle } from './styles';

export type ChartTable = { columns: string[]; rows: { label: string; cells: string[] }[] };

/**
 * A chart with its title, legend (for two or more series) and the same numbers as a table, so
 * nothing is only in the picture. `empty` replaces the chart when there is nothing to draw.
 */
export function ChartCard({
  title,
  note,
  legend,
  table,
  empty,
  children,
}: {
  title: string;
  note?: ReactNode;
  legend?: { label: string; style: SeriesStyle }[];
  table: ChartTable;
  empty?: string;
  children: ReactNode;
}) {
  return (
    <section className="break-inside-avoid rounded-[2rem] bg-white p-5 shadow-sm ring-2 ring-brand-100 sm:p-6 print:rounded-none print:p-0 print:shadow-none print:ring-0">
      <h2 className="text-xl font-black">{title}</h2>
      {note && <p className="mt-1 text-ink-soft">{note}</p>}
      {empty ? (
        <p className="mt-4 rounded-2xl bg-brand-50 p-4 text-ink-soft">{empty}</p>
      ) : (
        <>
          {legend && legend.length > 1 && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
              {legend.map((item) => (
                <li key={item.label} className="flex items-center gap-1.5 text-sm font-semibold">
                  <Swatch style={item.style} />
                  {item.label}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">{children}</div>
          <details className="mt-3 print:hidden">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-bold text-brand-700">
              Show as a table
            </summary>
            <DataTable caption={title} table={table} />
          </details>
        </>
      )}
    </section>
  );
}

export function DataTable({ caption, table }: { caption: string; table: ChartTable }) {
  return (
    <div className="mt-2 max-h-80 overflow-auto rounded-xl ring-1 ring-brand-100 print:max-h-none print:overflow-visible print:rounded-none print:ring-slate-300">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-brand-50">
          <tr>
            {table.columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2 font-bold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.label} className="border-t border-brand-100">
              <th scope="row" className="px-3 py-1.5 font-semibold whitespace-nowrap">
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td key={i} className="px-3 py-1.5 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
