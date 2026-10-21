import type { HomeSection } from "@/lib/theme/schema";

/**
 * Plantillas para páginas de contenido (Pulido, Paso 2). Crean la página en
 * borrador con texto guía y bloques; lo que hay que reemplazar va entre
 * corchetes. Las políticas no están aquí: nacen con la tienda
 * (`app.policy_template`) y se marcan «Pendiente de revisión legal».
 */
export interface PageTemplate {
  key: "contacto" | "preguntas" | "nosotros";
  name: string;
  title: string;
  body_html: string;
  sections: HomeSection[];
}

const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    key: "contacto",
    name: "Contacto",
    title: "Contacto",
    body_html:
      "<p>[Escribe cómo prefieres que te contacten y en qué horario respondes, por ejemplo: de lunes a viernes de 9 a 18 h.]</p>",
    sections: [
      {
        id: id(1),
        type: "contact_map",
        enabled: true,
        props: { title: "Escríbenos", show_whatsapp: true },
      },
      {
        id: id(2),
        type: "faq",
        enabled: true,
        props: {
          title: "Antes de escribirnos",
          items: [
            {
              question: "¿Cuánto tarda mi pedido?",
              answer: "[Tus tiempos de entrega reales por zona.]",
            },
            {
              question: "¿Cómo sigo mi envío?",
              answer: "[Cómo y cuándo envías el número de guía.]",
            },
          ],
        },
      },
    ],
  },
  {
    key: "preguntas",
    name: "Preguntas frecuentes",
    title: "Preguntas frecuentes",
    body_html: "<p>[Una frase de bienvenida: qué encontrará aquí tu cliente.]</p>",
    sections: [
      {
        id: id(1),
        type: "faq",
        enabled: true,
        props: {
          title: "Preguntas frecuentes",
          items: [
            {
              question: "¿Cuánto tarda mi pedido?",
              answer: "[Tus tiempos de entrega reales por zona.]",
            },
            { question: "¿Cómo puedo pagar?", answer: "[Los métodos de pago que aceptas.]" },
            {
              question: "¿Puedo cambiar o devolver un producto?",
              answer: "[Resumen de tu política de devoluciones.]",
            },
            { question: "¿Facturan?", answer: "[Si emites factura y cómo solicitarla.]" },
          ],
        },
      },
    ],
  },
  {
    key: "nosotros",
    name: "Nosotros",
    title: "Nosotros",
    body_html:
      "<p>[Cuenta en dos o tres frases quiénes son, desde cuándo venden y qué los distingue.]</p>",
    sections: [
      {
        id: id(1),
        type: "benefits",
        enabled: true,
        props: {
          title: "Por qué comprarnos",
          items: [
            { icon: "truck", title: "[Primera razón]", text: "[Explícala en una frase.]" },
            { icon: "shield", title: "[Segunda razón]", text: "[Explícala en una frase.]" },
            { icon: "return", title: "[Tercera razón]", text: "[Explícala en una frase.]" },
          ],
        },
      },
    ],
  },
];

export function findPageTemplate(key: string): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((t) => t.key === key);
}
