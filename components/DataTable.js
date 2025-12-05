'use client';

export default function DataTable({ columns, data, highlightCondition }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-700">
            {columns.map((col, i) => (
              <th 
                key={i} 
                className={`py-3 px-4 text-sm text-slate-400 font-medium ${col.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr 
              key={rowIndex} 
              className={`border-b border-slate-800 transition-colors hover:bg-slate-800/50 ${highlightCondition && highlightCondition(row) ? 'bg-emerald-500/10' : ''}`}
            >
              {columns.map((col, colIndex) => (
                <td 
                  key={colIndex} 
                  className={`py-3 px-4 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.className ? col.className(row) : 'text-white'}`}
                >
                  {col.render ? col.render(row) : row[col.accessor]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
