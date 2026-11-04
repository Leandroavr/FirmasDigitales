import React, { useState, useMemo } from "react";
import ModalUi from "../../primitives/ModalUi";
import { useTranslation } from "react-i18next";

function formatDisplayName(raw, email) {
  if (!raw && email) raw = email.split("@")[0];
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed.includes(".") && !trimmed.includes(" ")) {
    return trimmed
      .split(".")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }
  return trimmed;
}

// Configuración de niveles jerárquicos de la empresa
const LEVEL_CONFIG = {
  "Presidencia": {
    order: 1,
    title: "Presidencia",
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
    borderClass: "border-amber-400",
    icon: "fa-crown",
  },
  "Dirección": {
    order: 2,
    title: "Dirección",
    badgeClass: "bg-purple-100 text-purple-900 border-purple-300",
    borderClass: "border-purple-400",
    icon: "fa-user-tie",
  },
  "Gerencia": {
    order: 3,
    title: "Gerencia",
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
    borderClass: "border-blue-400",
    icon: "fa-briefcase",
  },
  "Jefatura de Grupo": {
    order: 4,
    title: "Jefatura de Grupo",
    badgeClass: "bg-teal-100 text-teal-900 border-teal-300",
    borderClass: "border-teal-400",
    icon: "fa-users-gear",
  },
  "Especialista / Base": {
    order: 5,
    title: "Especialista / Base",
    badgeClass: "bg-slate-100 text-slate-800 border-slate-300",
    borderClass: "border-slate-300",
    icon: "fa-user",
  },
};

const OrganigramaModal = ({
  isOpen,
  handleClose,
  allUsers = [],
  selected = [],
  onToggleUser,
}) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedNodes, setCollapsedNodes] = useState({});
  const [zoom, setZoom] = useState(100);

  // Filtrar fuera al Administrador General y usuarios inactivos
  const validUsers = useMemo(() => {
    return (allUsers || []).filter((u) => {
      const email = (u?.Email || u?.email || "").toLowerCase().trim();
      const isAdmin = email === "admin@brascuba.cu";
      const isDisabled = u?.IsDisabled === true || u?.isDisabled === true;
      return !isAdmin && !isDisabled;
    });
  }, [allUsers]);

  // Detección de nombres duplicados para mostrar correo secundario
  const duplicateNames = useMemo(() => {
    const counts = {};
    for (const u of validUsers) {
      const n = formatDisplayName(u?.Name, u?.Email).toLowerCase();
      if (n) counts[n] = (counts[n] || 0) + 1;
    }
    return new Set(Object.keys(counts).filter((n) => counts[n] > 1));
  }, [validUsers]);

  const isUserSelected = (user) => {
    return selected.some(
      (s) =>
        s.value === user.objectId ||
        s.objectId === user.objectId ||
        s.value === user.extUserId ||
        (s.email && s.email.toLowerCase() === (user.Email || "").toLowerCase())
    );
  };

  // Construir el árbol jerárquico completo basado en ReportsTo y HierarchyLevel
  const { treeRoots, unassignedUsers } = useMemo(() => {
    const userMap = new Map();
    const cloned = validUsers.map((u) => ({
      ...u,
      displayName: formatDisplayName(u?.Name, u?.Email),
      hierarchyLevel: u?.HierarchyLevel || "Especialista / Base",
      reportsTo: u?.ReportsTo || "",
      children: [],
      hasParent: false,
    }));

    // Indexar por objectId, extUserId y Email
    cloned.forEach((u) => {
      if (u.objectId) userMap.set(u.objectId, u);
      if (u.extUserId) userMap.set(u.extUserId, u);
      if (u.Email) userMap.set(u.Email.toLowerCase().trim(), u);
    });

    // Vincular subordinados con sus superiores mediante reportsTo
    cloned.forEach((u) => {
      if (u.reportsTo) {
        const parent =
          userMap.get(u.reportsTo) || userMap.get(u.reportsTo.toLowerCase().trim());
        if (parent && parent !== u) {
          parent.children.push(u);
          u.hasParent = true;
        }
      }
    });

    // Ordenar hijos según nivel jerárquico
    const sortNodes = (nodes) => {
      return nodes.sort((a, b) => {
        const orderA = LEVEL_CONFIG[a.hierarchyLevel]?.order || 99;
        const orderB = LEVEL_CONFIG[b.hierarchyLevel]?.order || 99;
        if (orderA !== orderB) return orderA - orderB;
        return (a.displayName || "").localeCompare(b.displayName || "");
      });
    };

    cloned.forEach((u) => {
      if (u.children.length > 0) {
        u.children = sortNodes(u.children);
      }
    });

    // Raíces del árbol:
    // 1. Nodos de Presidencia o Dirección
    // 2. Nodos sin superior asignado que tengan subordinados o rango directivo
    const roots = [];
    const unassigned = [];

    cloned.forEach((u) => {
      if (!u.hasParent) {
        if (
          u.hierarchyLevel === "Presidencia" ||
          u.hierarchyLevel === "Dirección" ||
          u.children.length > 0 ||
          u.hierarchyLevel === "Gerencia" ||
          u.hierarchyLevel === "Jefatura de Grupo"
        ) {
          roots.push(u);
        } else {
          unassigned.push(u);
        }
      }
    });

    return {
      treeRoots: sortNodes(roots),
      unassignedUsers: sortNodes(unassigned),
    };
  }, [validUsers]);

  // Comprobar si un nodo o alguno de sus descendientes coincide con la búsqueda
  const nodeMatchesSearch = (node, term) => {
    if (!term) return true;
    const n = (node.displayName || "").toLowerCase();
    const j = (node.JobTitle || "").toLowerCase();
    const d = (node.Department || "").toLowerCase();
    const e = (node.Email || "").toLowerCase();
    const l = (node.hierarchyLevel || "").toLowerCase();

    const directMatch =
      n.includes(term) || j.includes(term) || d.includes(term) || e.includes(term) || l.includes(term);

    if (directMatch) return true;
    return (node.children || []).some((child) => nodeMatchesSearch(child, term));
  };

  const toggleNode = (nodeId) => {
    setCollapsedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  const expandAll = () => setCollapsedNodes({});
  const collapseAll = () => {
    const all = {};
    const markCollapsed = (nodes) => {
      nodes.forEach((n) => {
        if (n.children && n.children.length > 0) {
          all[n.objectId] = true;
          markCollapsed(n.children);
        }
      });
    };
    markCollapsed(treeRoots);
    setCollapsedNodes(all);
  };

  const term = searchTerm.trim().toLowerCase();

  // Renderizar la tarjeta visual de un colaborador (Compacta y sin datos repetidos)
  const renderNodeCard = (node) => {
    const isSelected = isUserSelected(node);
    const isDup = duplicateNames.has((node.displayName || "").toLowerCase());
    const config = LEVEL_CONFIG[node.hierarchyLevel] || LEVEL_CONFIG["Especialista / Base"];
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = term ? false : Boolean(collapsedNodes[node.objectId]);

    const directMatch = term && (
      (node.displayName || "").toLowerCase().includes(term) ||
      (node.JobTitle || "").toLowerCase().includes(term) ||
      (node.Department || "").toLowerCase().includes(term) ||
      (node.Email || "").toLowerCase().includes(term)
    );

    return (
      <div
        onClick={() => onToggleUser(node)}
        className={`w-44 bg-base-100 rounded-xl border-2 transition-all shadow-xs hover:shadow-md cursor-pointer flex flex-col justify-between overflow-hidden group select-none p-2 ${
          isSelected
            ? "border-primary ring-2 ring-primary/40 bg-primary/10 text-primary shadow-sm"
            : directMatch
            ? "border-amber-400 ring-2 ring-amber-300/50 bg-amber-50/20"
            : "border-base-200 hover:border-primary/50 hover:bg-base-200/30"
        }`}
        title={isSelected ? "Clic para deseleccionar firmante" : "Clic para seleccionar firmante"}
      >
        {/* Fila superior: Nivel jerárquico + Checkbox indicador */}
        <div className="flex items-center justify-between gap-1 mb-1">
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border flex items-center gap-1 truncate ${config.badgeClass}`}
          >
            <i className={`fa-light ${config.icon} text-[8px]`}></i>
            <span className="truncate">{node.hierarchyLevel}</span>
          </span>

          {/* Indicador de selección */}
          <div
            className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 transition-all ${
              isSelected
                ? "bg-primary text-white shadow-xs"
                : "border-2 border-base-300 group-hover:border-primary/50"
            }`}
          >
            {isSelected && <i className="fa-solid fa-check"></i>}
          </div>
        </div>

        {/* Cuerpo compacto: Avatar + Nombre + Cargo */}
        <div className="flex flex-col items-center text-center my-1">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-xs mb-1 transition-all ${
              isSelected
                ? "bg-primary text-white scale-105"
                : "bg-primary/10 text-primary border border-primary/20"
            }`}
          >
            {(node.displayName || "?").charAt(0).toUpperCase()}
          </div>

          <h4 className="font-bold text-xs text-base-content truncate w-full group-hover:text-primary transition-colors">
            {node.displayName}
          </h4>

          {/* Cargo (sin repetir departamento) */}
          <p
            className="text-[11px] font-medium text-base-content/70 truncate w-full mt-0.5"
            title={node.JobTitle || node.Department}
          >
            {node.JobTitle || node.Department || <span className="italic text-base-content/40">Sin cargo</span>}
          </p>

          {isDup && (
            <p className="text-[9px] text-base-content/40 italic truncate w-full">
              {node.Email}
            </p>
          )}
        </div>

        {/* Pie: Plegar/Desplegar equipo */}
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleNode(node.objectId);
            }}
            className="pt-1 mt-1 border-t border-base-200/80 text-[10px] font-semibold text-base-content/60 hover:text-primary flex items-center justify-center gap-1 w-full transition-colors"
            title={isCollapsed ? "Expandir subordinados" : "Ocultar subordinados"}
          >
            <span>{isCollapsed ? "Ver" : "Ocultar"} ({node.children.length})</span>
            <i className={`fa-light ${isCollapsed ? "fa-chevron-down" : "fa-chevron-up"} text-[8px]`}></i>
          </button>
        )}
      </div>
    );
  };

  // Renderizador recursivo del árbol Top-Down con conectores
  const renderTreeBranch = (node) => {
    if (term && !nodeMatchesSearch(node, term)) {
      return null;
    }

    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = term ? false : Boolean(collapsedNodes[node.objectId]);

    return (
      <div key={node.objectId || node.Email} className="flex flex-col items-center">
        {/* 1. Tarjeta del Nodo */}
        {renderNodeCard(node)}

        {/* 2. Conectores visuales y sub-ramas (si tiene hijos y no está colapsado) */}
        {hasChildren && !isCollapsed && (
          <div className="flex flex-col items-center w-full">
            {/* Tallo vertical hacia abajo desde el padre */}
            <div className="w-0.5 h-5 bg-slate-300"></div>

            {/* Fila horizontal que conecta a todos los hijos */}
            <div className="flex justify-center items-start relative w-full">
              {node.children.map((child, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === node.children.length - 1;
                const isOnly = node.children.length === 1;

                return (
                  <div key={child.objectId || child.Email} className="flex flex-col items-center px-2.5 relative">
                    {/* Barra horizontal sobre los hermanos */}
                    {!isOnly && (
                      <div
                        className={`absolute top-0 h-0.5 bg-slate-300 ${
                          isFirst
                            ? "left-1/2 right-0"
                            : isLast
                            ? "left-0 right-1/2"
                            : "left-0 right-0"
                        }`}
                      />
                    )}

                    {/* Tallo vertical hacia la tarjeta del hijo */}
                    <div className="w-0.5 h-5 bg-slate-300 z-10"></div>

                    {/* Render recursivo de los descendientes */}
                    {renderTreeBranch(child)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <ModalUi
      isOpen={isOpen}
      title={t("organigrama-title", { defaultValue: "Organigrama de la Empresa (Brascuba)" })}
      handleClose={handleClose}
      reduceWidth="w-11/12 max-w-7xl min-w-[720px]"
      showScrollBar={true}
    >
      <div className="p-4 flex flex-col max-h-[82vh]">
        {/* Barra superior: Buscador, Controles de Zoom y Expansión */}
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between mb-3 pb-3 border-b border-base-200">
          {/* Buscador en vivo */}
          <div className="relative w-full md:w-80">
            <i className="fa-light fa-magnifying-glass absolute left-3 top-2.5 text-base-content/50 text-xs"></i>
            <input
              type="text"
              className="op-input op-input-bordered op-input-sm w-full pl-8 text-xs focus:outline-none"
              placeholder="Buscar por nombre, cargo, nivel o correo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-2 text-base-content/50 hover:text-base-content text-xs"
              >
                <i className="fa-light fa-xmark"></i>
              </button>
            )}
          </div>

          {/* Controles de Vista: Zoom y Expansión */}
          <div className="flex items-center gap-2 w-full md:w-auto justify-end">
            {/* Controles de Zoom */}
            <div className="join border border-base-300 rounded-lg overflow-hidden bg-base-200/50 p-0.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(50, z - 10))}
                className="join-item op-btn op-btn-ghost op-btn-xs px-2"
                title="Alejar organigrama"
              >
                <i className="fa-light fa-magnifying-glass-minus"></i>
              </button>
              <button
                type="button"
                onClick={() => setZoom(100)}
                className="join-item op-btn op-btn-ghost op-btn-xs text-[10px] font-semibold px-2"
                title="Restablecer zoom a 100%"
              >
                {zoom}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(130, z + 10))}
                className="join-item op-btn op-btn-ghost op-btn-xs px-2"
                title="Acercar organigrama"
              >
                <i className="fa-light fa-magnifying-glass-plus"></i>
              </button>
            </div>

            <div className="divider divider-horizontal my-1 mx-0.5 hidden sm:flex"></div>

            <button
              type="button"
              onClick={expandAll}
              className="op-btn op-btn-ghost op-btn-xs text-[11px] rounded-lg"
            >
              <i className="fa-light fa-arrows-maximize mr-1"></i>
              Expandir todo
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="op-btn op-btn-ghost op-btn-xs text-[11px] rounded-lg"
            >
              <i className="fa-light fa-arrows-minimize mr-1"></i>
              Colapsar todo
            </button>
          </div>
        </div>

        {/* Resumen de firmantes seleccionados y Leyenda de Niveles */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-base-200/60 rounded-xl mb-3 border border-base-200 text-xs">
          <div className="flex items-center gap-2 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>
              <strong>{selected.length}</strong> firmante(s) seleccionado(s)
            </span>
            <span className="text-base-content/40">•</span>
            <span className="text-[11px] text-base-content/60">
              Haz clic en cualquier tarjeta para agregarla o quitarla
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            {Object.entries(LEVEL_CONFIG).map(([lvl, conf]) => (
              <span
                key={lvl}
                className={`px-2 py-0.5 rounded-full border font-semibold ${conf.badgeClass} flex items-center gap-1`}
              >
                <i className={`fa-light ${conf.icon} text-[9px]`}></i>
                <span>{conf.title}</span>
              </span>
            ))}
          </div>
        </div>

        {/* LIENZO DEL ORGANIGRAMA TOP-DOWN (Scroll bidireccional fluido) */}
        <div className="overflow-auto flex-1 p-6 bg-slate-50/70 dark:bg-base-300/30 rounded-2xl border border-base-200 min-h-[460px] max-h-[58vh]">
          {treeRoots.length === 0 && unassignedUsers.length === 0 ? (
            <div className="text-center py-16 text-base-content/60 text-xs">
              <i className="fa-light fa-users-slash text-4xl mb-2 block opacity-40"></i>
              No se encontraron colaboradores que coincidan con la búsqueda.
            </div>
          ) : (
            <div
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
                transition: "transform 0.15s ease-out",
              }}
              className="inline-flex flex-col items-center w-full min-w-max pb-8"
            >
              {/* Raíces del Árbol Organigrama */}
              <div className="flex justify-center items-start gap-8">
                {treeRoots.map((root) => renderTreeBranch(root))}
              </div>

              {/* Colaboradores adicionales (por asignar o sin superior directo) */}
              {unassignedUsers.length > 0 && (!term || unassignedUsers.some((u) => nodeMatchesSearch(u, term))) && (
                <div className="mt-10 pt-6 border-t-2 border-dashed border-base-300 w-full flex flex-col items-center">
                  <div className="flex items-center gap-2 mb-4 text-xs font-bold text-base-content/75 px-3 py-1 rounded-full bg-base-200/80 border border-base-300">
                    <i className="fa-light fa-users text-primary"></i>
                    <span>Otros Colaboradores / Sin superior directo asignado</span>
                    <span className="badge badge-sm badge-ghost text-[10px] font-bold">
                      {unassignedUsers.length}
                    </span>
                  </div>

                  <div className="flex flex-wrap justify-center gap-3 max-w-5xl">
                    {unassignedUsers.map((u) => renderNodeCard(u))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pie del Modal */}
        <div className="flex justify-between items-center pt-3 border-t border-base-200 mt-3">
          <span className="text-xs text-base-content/70">
            Total en organigrama: <strong>{validUsers.length}</strong> colaboradores
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="op-btn op-btn-primary op-btn-sm text-xs !text-white px-6 rounded-lg shadow-sm"
          >
            {t("ready", { defaultValue: "Listo" })}
          </button>
        </div>
      </div>
    </ModalUi>
  );
};

export default OrganigramaModal;
