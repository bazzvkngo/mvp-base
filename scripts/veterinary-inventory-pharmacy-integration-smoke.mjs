import assert
  from "node:assert/strict";

import {
  adaptInventoryItemForVeterinary,
  buildVeterinaryInventoryCatalog,
  buildVeterinaryInventoryReference,
  canUseVeterinaryPharmacyProduct,
  getVeterinaryPharmacyProducts,
  getVeterinaryPharmacyStockStatus,
  getVeterinaryServicesFromInventory,
} from "../src/features/veterinary/domain/inventoryPharmacyIntegrationModel.mjs";


function testAvailableProduct() {
  const item =
    adaptInventoryItemForVeterinary({
      id:
        "product-001",

      tipoItem:
        "producto",

      nombre:
        "Amoxicilina",

      codigoInterno:
        "PR-001",

      unidadStock:
        "unidad",

      estado:
        "activo",

      stock:
        10,

      stockMinimo:
        3,
    });


  assert.equal(
    item.itemId,
    "product-001"
  );

  assert.equal(
    item.tipoItem,
    "producto"
  );

  assert.equal(
    item.stock,
    10
  );

  assert.equal(
    item.stockStatus,
    "disponible"
  );
}


function testLowStockProduct() {
  assert.equal(
    getVeterinaryPharmacyStockStatus({
      tipoItem:
        "producto",

      stock:
        3,

      stockMinimo:
        5,
    }),

    "stock_bajo"
  );
}


function testOutOfStockProduct() {
  assert.equal(
    getVeterinaryPharmacyStockStatus({
      tipoItem:
        "producto",

      stock:
        0,

      stockMinimo:
        5,
    }),

    "sin_stock"
  );
}


function testServiceHasNoStock() {
  const service =
    adaptInventoryItemForVeterinary({
      id:
        "service-001",

      tipoItem:
        "servicio",

      nombre:
        "Consulta veterinaria",

      estado:
        "activo",

      unidad:
        "servicio",

      stock:
        500,
    });


  assert.equal(
    service.stock,
    null
  );

  assert.equal(
    service.stockMinimo,
    null
  );

  assert.equal(
    service.stockStatus,
    "no_aplica"
  );
}


function testActivityIsIgnored() {
  const activity =
    adaptInventoryItemForVeterinary({
      id:
        "activity-001",

      tipoItem:
        "actividad",

      nombre:
        "Actividad interna",

      estado:
        "activo",
    });


  assert.equal(
    activity,
    null
  );
}


function testInactiveItemsAreFiltered() {
  const catalog =
    buildVeterinaryInventoryCatalog([
      {
        id:
          "product-active",

        tipoItem:
          "producto",

        nombre:
          "Producto activo",

        estado:
          "activo",

        stock:
          5,
      },

      {
        id:
          "product-inactive",

        tipoItem:
          "producto",

        nombre:
          "Producto inactivo",

        estado:
          "inactivo",

        stock:
          5,
      },
    ]);


  assert.equal(
    catalog.length,
    1
  );

  assert.equal(
    catalog[0].itemId,
    "product-active"
  );
}


function testProductsAndServicesAreSeparated() {
  const inventory = [
    {
      id:
        "product-001",

      tipoItem:
        "producto",

      nombre:
        "Jeringa 5 ml",

      estado:
        "activo",

      stock:
        8,
    },

    {
      id:
        "service-001",

      tipoItem:
        "servicio",

      nombre:
        "Consulta veterinaria",

      estado:
        "activo",
    },

    {
      id:
        "activity-001",

      tipoItem:
        "actividad",

      nombre:
        "Actividad administrativa",

      estado:
        "activo",
    },
  ];


  const products =
    getVeterinaryPharmacyProducts(
      inventory
    );


  const services =
    getVeterinaryServicesFromInventory(
      inventory
    );


  assert.equal(
    products.length,
    1
  );

  assert.equal(
    products[0].itemId,
    "product-001"
  );


  assert.equal(
    services.length,
    1
  );

  assert.equal(
    services[0].itemId,
    "service-001"
  );
}


function testCanUseAvailableProduct() {
  assert.equal(
    canUseVeterinaryPharmacyProduct({
      id:
        "product-001",

      tipoItem:
        "producto",

      nombre:
        "Suero fisiológico",

      estado:
        "activo",

      stock:
        2,

      stockMinimo:
        5,
    }),

    true
  );
}


function testCannotUseOutOfStockProduct() {
  assert.equal(
    canUseVeterinaryPharmacyProduct({
      id:
        "product-001",

      tipoItem:
        "producto",

      nombre:
        "Suero fisiológico",

      estado:
        "activo",

      stock:
        0,

      stockMinimo:
        5,
    }),

    false
  );
}


function testSafeVeterinaryReference() {
  const reference =
    buildVeterinaryInventoryReference(
      {
        id:
          "product-001",

        tipoItem:
          "producto",

        nombre:
          "Amoxicilina",

        codigoInterno:
          "PR-001",

        unidadStock:
          "unidad",

        estado:
          "activo",

        stock:
          12,

        stockMinimo:
          3,

        costoPromedio:
          4500,

        valorInventario:
          54000,

        precioInterno:
          7000,

        negocioId:
          "business-fake",

        businessId:
          "business-fake",

        creadoPorUid:
          "uid-fake",
      },

      2
    );


  assert.deepEqual(
    reference,
    {
      itemId:
        "product-001",

      tipoItem:
        "producto",

      nombre:
        "Amoxicilina",

      codigoInterno:
        "PR-001",

      unidad:
        "unidad",

      cantidad:
        2,
    }
  );


  for (
    const field of [
      "stock",
      "stockMinimo",
      "costoPromedio",
      "valorInventario",
      "precioInterno",
      "negocioId",
      "businessId",
      "creadoPorUid",
    ]
  ) {
    assert.equal(
      Object.hasOwn(
        reference,
        field
      ),
      false
    );
  }
}


function testOutOfStockReferenceIsRejected() {
  assert.throws(
    () =>
      buildVeterinaryInventoryReference(
        {
          id:
            "product-001",

          tipoItem:
            "producto",

          nombre:
            "Medicamento sin stock",

          estado:
            "activo",

          stock:
            0,
        },

        1
      )
  );
}


function testInvalidQuantityIsRejected() {
  assert.throws(
    () =>
      buildVeterinaryInventoryReference(
        {
          id:
            "service-001",

          tipoItem:
            "servicio",

          nombre:
            "Consulta veterinaria",

          estado:
            "activo",
        },

        0
      )
  );
}


function testQuantityAboveStockIsRejected() {
  assert.throws(
    () =>
      buildVeterinaryInventoryReference(
        {
          id:
            "product-limited",

          tipoItem:
            "producto",

          nombre:
            "Producto con stock limitado",

          estado:
            "activo",

          stock:
            3,

          stockMinimo:
            1,
        },

        4
      )
  );
}

function testInactiveReferenceIsRejected() {
  assert.throws(
    () =>
      buildVeterinaryInventoryReference(
        {
          id: "product-inactive",
          tipoItem: "producto",
          nombre: "Producto inactivo",
          codigoInterno: "PRO-INACTIVE-001",
          estado: "inactivo",
          stock: 10,
          stockMinimo: 2,
          unidad: "unidad",
        },
        1
      )
  );
}


testAvailableProduct();

testLowStockProduct();

testOutOfStockProduct();

testServiceHasNoStock();

testActivityIsIgnored();

testInactiveItemsAreFiltered();

testProductsAndServicesAreSeparated();

testCanUseAvailableProduct();

testCannotUseOutOfStockProduct();

testSafeVeterinaryReference();

testOutOfStockReferenceIsRejected();

testInvalidQuantityIsRejected();

testQuantityAboveStockIsRejected();

testInactiveReferenceIsRejected();

console.log(
  "OK veterinary-inventory-pharmacy-integration-smoke"
);