import { EmptyState } from "@/ui/primitives/empty-state";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-16">
      <EmptyState
        title="Plataforma en construcción"
        description="La base técnica está lista. El acceso al panel de tiendas se habilita en la siguiente fase."
      />
    </main>
  );
}
