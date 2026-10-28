// Boton para subir imagenes, videos o audios a la biblioteca de LucidSales
// (POST /biblioteca/uploadS3File) y devolver sus urls publicas.
import { useRef, useState } from "react";
import { biblioteca, urlsDeRespuesta } from "../api/endpoints";
import { errMsg } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./Toast";

export function SubirMedia({
  accept = "image/*",
  multiple = true,
  texto = "⬆ Subir archivo",
  onSubido,
}: {
  accept?: string;
  multiple?: boolean;
  texto?: string;
  onSubido: (urls: string[]) => void;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);

  const subir = async (archivos: FileList | null) => {
    const lista = Array.from(archivos ?? []);
    if (!lista.length) return;
    const idShop = session?.tiendaActiva;
    if (!idShop) {
      toast.error("Elige una tienda antes de subir archivos");
      return;
    }
    const urls: string[] = [];
    try {
      for (const [n, a] of lista.entries()) {
        setSubiendo(lista.length > 1 ? `${n + 1}/${lista.length}` : "…");
        const r = await biblioteca.subir(a, idShop);
        const nuevas = urlsDeRespuesta(r);
        if (!nuevas.length) {
          throw new Error(`LucidSales no devolvió la url de «${a.name}» (respuesta: ${JSON.stringify(r).slice(0, 160)})`);
        }
        urls.push(...nuevas);
      }
      toast.success(urls.length === 1 ? "Archivo subido" : `${urls.length} archivos subidos`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      if (urls.length) onSubido(urls);
      setSubiendo(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: "none" }}
        onChange={(e) => void subir(e.target.files)}
      />
      <button type="button" className="btn sm" disabled={subiendo !== null} onClick={() => input.current?.click()}>
        {subiendo !== null ? `Subiendo ${subiendo}` : texto}
      </button>
    </>
  );
}
