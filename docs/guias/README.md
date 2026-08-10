# Guías de uso

Una por rol, para imprimir y tener al lado del teclado.

| Archivo | Para quién | Qué cubre |
|---|---|---|
| `Guia-Ventas.pdf` | Ventas | Dar de alta servicios, incrementos, cancelaciones, precio por puesto |
| `Guia-Operaciones.pdf` | Operaciones | Altas y bajas, suspender un servicio, nómina, aperturas pendientes |
| `Guia-Cobranza-y-Finanzas.pdf` | Cobranza | Facturar el mes, la conciliación, pagos, cartera vencida, precios |
| `Guia-Jurídico.pdf` | Jurídico | Contratos, vigencias, PDF del contrato, razón social |
| `Guia-Administrador.pdf` | Administrador | Todo lo anterior más usuarios, catálogos, correcciones y respaldos |
| `Guia-Espectador.pdf` | Espectador | Cómo leer las pantallas de consulta |

El `.html` de cada una es el mismo contenido, por si alguien prefiere leerlo en
pantalla o quiere imprimirlo desde el navegador.

## Cómo regenerarlas

El texto vive en `scripts/guias/contenido.mjs`, que es lo único que hay que
editar cuando la plataforma cambie. El diseño está en `scripts/guias/generar.mjs`.

```
node scripts/guias/generar.mjs
```

Los permisos que cada guía describe no están escritos de memoria: salen de
`lib/rbac.js` y se verificaron contra las rutas de la API. Si un rol cambia lo
que puede hacer, hay que actualizar su guía en el mismo cambio — una guía que
dice de más es peor que no tener guía.
