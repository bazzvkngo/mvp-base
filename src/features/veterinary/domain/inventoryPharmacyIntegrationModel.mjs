export const VETERINARY_PHARMACY_STOCK_STATUSES =
  Object.freeze([
    "disponible",
    "stock_bajo",
    "sin_stock",
    "no_aplica",
  ]);


function normalizeText(
  value,
  maxLength = 500
) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}


function normalizeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


export function getVeterinaryPharmacyStockStatus(
  rawItem = {}
) {
  const tipoItem =
    normalizeText(
      rawItem.tipoItem,
      40
    ).toLowerCase();


  if (
    tipoItem !== "producto"
  ) {
    return "no_aplica";
  }


  const stock =
    Math.max(
      normalizeNumber(
        rawItem.stock,
        0
      ),
      0
    );


  const stockMinimo =
    Math.max(
      normalizeNumber(
        rawItem.stockMinimo,
        0
      ),
      0
    );


  if (
    stock <= 0
  ) {
    return "sin_stock";
  }


  if (
    stockMinimo > 0 &&
    stock <= stockMinimo
  ) {
    return "stock_bajo";
  }


  return "disponible";
}


export function adaptInventoryItemForVeterinary(
  rawItem = {}
) {
  const tipoItem =
    normalizeText(
      rawItem.tipoItem,
      40
    ).toLowerCase();


  if (
    tipoItem !== "producto" &&
    tipoItem !== "servicio"
  ) {
    return null;
  }


  const itemId =
    normalizeText(
      rawItem.id ||
      rawItem.itemId,
      120
    );


  const nombre =
    normalizeText(
      rawItem.nombre,
      180
    );


  if (
    !itemId ||
    !nombre
  ) {
    return null;
  }


  const estado =
    normalizeText(
      rawItem.estado || "activo",
      40
    ).toLowerCase();


  const stock =
    tipoItem === "producto"
      ? Math.max(
          normalizeNumber(
            rawItem.stock,
            0
          ),
          0
        )
      : null;


  const stockMinimo =
    tipoItem === "producto"
      ? Math.max(
          normalizeNumber(
            rawItem.stockMinimo,
            0
          ),
          0
        )
      : null;


  return {
    itemId,

    tipoItem,

    nombre,

    codigoInterno:
      normalizeText(
        rawItem.codigoInterno ||
        rawItem.sku,
        120
      ),

    unidad:
      normalizeText(
        rawItem.unidadStock ||
        rawItem.unidad ||
        "unidad",
        80
      ),

    estado,

    stock,

    stockMinimo,

    stockStatus:
      getVeterinaryPharmacyStockStatus({
        tipoItem,
        stock,
        stockMinimo,
      }),
  };
}


export function buildVeterinaryInventoryCatalog(
  inventoryItems = []
) {
  if (
    !Array.isArray(
      inventoryItems
    )
  ) {
    return [];
  }


  return inventoryItems
    .map(
      adaptInventoryItemForVeterinary
    )
    .filter(Boolean)
    .filter(
      (item) =>
        item.estado ===
        "activo"
    );
}


export function getVeterinaryServicesFromInventory(
  inventoryItems = []
) {
  return buildVeterinaryInventoryCatalog(
    inventoryItems
  ).filter(
    (item) =>
      item.tipoItem ===
      "servicio"
  );
}


export function getVeterinaryPharmacyProducts(
  inventoryItems = []
) {
  return buildVeterinaryInventoryCatalog(
    inventoryItems
  ).filter(
    (item) =>
      item.tipoItem ===
      "producto"
  );
}


export function canUseVeterinaryPharmacyProduct(
  rawItem = {}
) {
  const item =
    adaptInventoryItemForVeterinary(
      rawItem
    );


  if (
    !item ||
    item.tipoItem !==
      "producto" ||
    item.estado !==
      "activo"
  ) {
    return false;
  }


  return (
    item.stockStatus !==
    "sin_stock"
  );
}


export function buildVeterinaryInventoryReference(
  rawItem = {},
  quantity = 1
) {
  const item =
    adaptInventoryItemForVeterinary(
      rawItem
    );


  if (!item) {
    throw new Error(
      "El ítem de inventario no es válido para Veterinaria."
    );
  }

    if (
    item.estado !==
    "activo"
    ) {
    throw new Error(
        "El ítem de inventario no está activo."
    );
    }
  const cantidad =
    Number(quantity);


  if (
    !Number.isFinite(
      cantidad
    ) ||
    cantidad <= 0
  ) {
    throw new Error(
      "La cantidad debe ser mayor que cero."
    );
  }


  if (
    item.tipoItem ===
      "producto" &&
    item.stockStatus ===
      "sin_stock"
  ) {
    throw new Error(
      "El producto no tiene stock disponible."
    );
  }


  if (
  item.tipoItem ===
    "producto" &&
  cantidad > item.stock
) {
  throw new Error(
    "La cantidad solicitada supera el stock disponible."
  );
}


  if (
  item.tipoItem ===
    "producto" &&
  cantidad > item.stock
) {
  throw new Error(
    "La cantidad solicitada supera el stock disponible."
  );
}


  return {
    itemId:
      item.itemId,

    tipoItem:
      item.tipoItem,

    nombre:
      item.nombre,

    codigoInterno:
      item.codigoInterno,

    unidad:
      item.unidad,

    cantidad,
  };
}