/**
 * Emblema de Ultra: el disco rojo con la casa protegida por cinco manos.
 * El trazo viene del currículum corporativo 2026 y vive en public/logo-ultra.svg
 * para que el navegador lo cachee una vez y no se repita en cada página.
 */
export default function Logo({ size = 28, className = '' }) {
  return (
    <img
      src="/logo-ultra.svg"
      alt="Ultra Seguridad Privada"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Emblema + nombre, como aparece en los documentos de la empresa. */
export function LogoConNombre({ size = 28, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo size={size} />
      <span className="font-semibold tracking-tight text-white leading-none">
        ULTRA
        <span className="block text-[9px] font-normal tracking-[0.18em] text-slate-500 leading-none mt-0.5">
          SEGURIDAD PRIVADA
        </span>
      </span>
    </span>
  );
}
