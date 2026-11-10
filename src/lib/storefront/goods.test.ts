import { describe, expect, it } from "vitest";

import { goodFor, shelfFor } from "./goods";

describe("goodFor", () => {
  it.each([
    ["Playeras", "shirt"],
    ["Ejemplo · Sudadera con capucha", "hoodie"],
    ["Pantalón de mezclilla", "pants"],
    ["Gorra de gabardina", "cap"],
    ["Proteína de suero", "tub"],
    ["Creatinas", "jar"],
    ["Vitaminas", "capsule"],
    ["Preentrenos", "shaker"],
    ["Cuidado de la piel", "dropper"],
    ["Labial mate", "lipstick"],
    ["Shampoo sin sulfatos", "comb"],
    ["Bebidas", "bottle"],
    ["Detergente líquido", "spray"],
    ["Papas fritas 170 g", "snack"],
    ["Arroz 1 kg", "jar"],
    ["Velas y aromas", "candle"],
    ["Collar ajustable para perro", "collar"],
    ["Accesorios", "bag"],
    ["Botanas", "snack"],
    ["Maceta de barro con plato", "plant"],
    ["Cama acolchada lavable", "petbed"],
    ["Botas de piel", "shoe"],
    ["Funda para laptop", "tag"],
    // Segunda tanda de plantillas (plan 2026-11-05).
    ["Anillos", "ring"],
    ["Aretes de aro pequeño", "ring"],
    ["Collares y dijes", "necklace"],
    ["Collar de cadena fina", "necklace"],
    ["Audio", "headphones"],
    ["Audífonos inalámbricos", "headphones"],
    ["Cargadores y cables", "plug"],
    ["Cable USB-C a USB-C 1 m", "plug"],
    ["Accesorios para celular", "phone"],
    ["Hogar inteligente", "bulb"],
    ["Foco inteligente Wi-Fi", "bulb"],
    ["Cuaderno profesional 100 hojas", "notebook"],
    ["Set de plumas 6 piezas", "pen"],
    ["Arte y manualidades", "pen"],
    ["Libro de bolsillo", "book"],
    ["Ramos y arreglos", "flower"],
    ["Peluches", "teddy"],
    ["Sonaja para bebé", "teddy"],
    ["Juegos y didácticos", "blocks"],
    ["Fiesta y cumpleaños", "balloon"],
    ["Cajas de regalo", "gift"],
    ["Tarjetas y detalles", "card"],
    ["Café de especialidad 250 g", "mug"],
    ["Té e infusiones", "mug"],
    ["Té negro 20 sobres", "mug"],
    ["Chocolate amargo 100 g", "snack"],
    ["Bebedero automático", "bowl"],
  ] as const)("%s → %s", (name, good) => {
    expect(goodFor(name)).toBe(good);
  });

  it("sin coincidencia usa el respaldo", () => {
    expect(goodFor("Destacados")).toBe("tag");
    expect(goodFor("Novedades", "box")).toBe("box");
  });

  it("palabras parecidas no se confunden con las nuevas", () => {
    expect(goodFor("Detergente líquido")).toBe("spray");
    expect(goodFor("Tenis deportivos")).toBe("shoe");
    expect(goodFor("Proteína de suero")).toBe("tub");
    expect(goodFor("Bebidas")).toBe("bottle");
    expect(goodFor("Collar ajustable para perro")).toBe("collar");
    expect(goodFor("Correas y collares")).toBe("collar");
  });

  it("lo específico gana: un collar no es un accesorio cualquiera", () => {
    expect(goodFor("Accesorios: collar y correa")).toBe("collar");
  });
});

describe("shelfFor", () => {
  it("un objeto por categoría, sin repetir, hasta el máximo", () => {
    expect(shelfFor(["Playeras", "Pantalones", "Sudaderas", "Accesorios"])).toEqual([
      "shirt",
      "pants",
      "hoodie",
      "bag",
    ]);
    expect(shelfFor(["Playeras", "Camisas", "Blusas"])).toEqual(["shirt", "bag", "tag"]);
  });

  it("sin categorías reconocibles completa con objetos genéricos", () => {
    expect(shelfFor([])).toEqual(["bag", "tag", "box"]);
    expect(shelfFor(["Destacados", "Novedades"])).toEqual(["bag", "tag", "box"]);
  });

  it("las palabras de los giros nuevos no chocan con colores, ropa ni cocina (revisión 2026-11-06)", () => {
    expect(goodFor("Sudadera rosa")).toBe("hoodie");
    expect(goodFor("Vestido rosa")).toBe("dress");
    expect(goodFor("Sudadera para bebé")).toBe("hoodie");
    expect(goodFor("Bloqueador solar")).not.toBe("blocks");
    expect(goodFor("Reloj inteligente")).not.toBe("bulb");
    expect(goodFor("Batería de cocina")).toBe("mug");
    // Lo que sí debe coincidir, como en las plantillas.
    expect(goodFor("Ramo de rosas")).toBe("flower");
    expect(goodFor("Ramos y arreglos")).toBe("flower");
    expect(goodFor("Bloques de construcción 100 piezas")).toBe("blocks");
    expect(goodFor("Foco inteligente Wi-Fi")).toBe("bulb");
    expect(goodFor("Hogar inteligente")).toBe("bulb");
    expect(goodFor("Sonaja para bebé")).toBe("teddy");
    expect(goodFor("Bebés")).toBe("teddy");
    expect(goodFor("Oso de peluche")).toBe("teddy");
    expect(goodFor("Cargador USB-C")).toBe("plug");
  });
});
