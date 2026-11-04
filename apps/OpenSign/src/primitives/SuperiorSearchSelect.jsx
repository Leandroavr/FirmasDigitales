import React, { useState, useRef, useEffect, useMemo } from "react";

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

const LEVEL_CONFIG = {
  "Presidencia": {
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
    icon: "fa-crown",
  },
  "Dirección": {
    badgeClass: "bg-purple-100 text-purple-900 border-purple-300",
    icon: "fa-user-tie",
  },
  "Gerencia": {
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
    icon: "fa-briefcase",
  },
  "Jefatura de Grupo": {
    badgeClass: "bg-teal-100 text-teal-900 border-teal-300",
    icon: "fa-users-gear",
  },
  "Especialista / Base": {
    badgeClass: "bg-slate-100 text-slate-800 border-slate-300",
    icon: "fa-user",
  },
};

const SuperiorSearchSelect = ({
  value,
  onChange,
  superiorsList = [],
  disabled = false,
  label = "Superior directo / Reporta a",
  hint = "Selecciona a la persona de la cual depende en el organigrama empresarial."
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);

  // Encontrar el objeto del superior actualmente seleccionado
  const selectedSuperior = useMemo(() => {
    if (!value) return null;
    return superiorsList.find((s) => s.objectId === value) || null;
  }, [value, superiorsList]);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filtrar lista en tiempo real por búsqueda
  const filteredList = useMemo(() => {
    if (!searchTerm.trim()) return superiorsList;
    const term = searchTerm.trim().toLowerCase();
    return superiorsList.filter((sup) => {
      const name = formatDisplayName(sup?.Name, sup?.Email).toLowerCase();
      const job = (sup?.JobTitle || "").toLowerCase();
      const dept = (sup?.Department || "").toLowerCase();
      const lvl = (sup?.HierarchyLevel || "").toLowerCase();
      const email = (sup?.Email || "").toLowerCase();
      return (
        name.includes(term) ||
        job.includes(term) ||
        dept.includes(term) ||
        lvl.includes(term) ||
        email.includes(term)
      );
    });
  }, [superiorsList, searchTerm]);

  const handleSelect = (supId) => {
    onChange(supId);
    setIsOpen(false);
    setSearchTerm("");
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange("");
    setSearchTerm("");
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {label && (
        <label className="block text-xs font-semibold mb-1 text-base-content">
          {label}
        </label>
      )}

      {/* Si hay alguien seleccionado y el desplegable no está abierto para buscar */}
      {selectedSuperior && !isOpen ? (
        <div className="flex items-center justify-between p-2.5 bg-base-200/60 rounded-xl border border-base-300 hover:border-primary/40 transition-colors">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 border border-primary/20">
              {(formatDisplayName(selectedSuperior?.Name, selectedSuperior?.Email) || "?")
                .charAt(0)
                .toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-base-content truncate">
                  {formatDisplayName(selectedSuperior?.Name, selectedSuperior?.Email)}
                </span>
                {selectedSuperior?.HierarchyLevel && (
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded-full font-semibold border ${
                      LEVEL_CONFIG[selectedSuperior.HierarchyLevel]?.badgeClass || "bg-slate-100"
                    }`}
                  >
                    {selectedSuperior.HierarchyLevel}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-base-content/60 truncate">
                {selectedSuperior?.JobTitle || "Sin cargo"}
                {selectedSuperior?.Department ? ` • ${selectedSuperior.Department}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-2">
            {!disabled && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(true);
                    setTimeout(() => inputRef.current?.focus(), 50);
                  }}
                  className="op-btn op-btn-ghost op-btn-xs text-xs text-primary hover:bg-primary/10 rounded-md"
                  title="Cambiar superior"
                >
                  <i className="fa-light fa-arrows-rotate mr-1"></i>
                  <span>Cambiar</span>
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="op-btn op-btn-ghost op-btn-xs text-base-content/60 hover:text-error hover:bg-error/10 rounded-md"
                  title="Quitar superior (Máxima Autoridad)"
                >
                  <i className="fa-light fa-xmark text-sm"></i>
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Modo Búsqueda / Input */
        <div className="relative">
          <div className="relative flex items-center">
            <i className="fa-light fa-magnifying-glass absolute left-3 text-base-content/40 text-xs"></i>
            <input
              ref={inputRef}
              type="text"
              disabled={disabled}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                if (!isOpen) setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              placeholder="Escribe para buscar por nombre, cargo o área..."
              className="op-input op-input-bordered op-input-sm w-full pl-8 pr-8 text-xs focus:outline-none focus:border-primary"
            />
            {searchTerm ? (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 text-base-content/40 hover:text-base-content text-xs"
              >
                <i className="fa-light fa-circle-xmark"></i>
              </button>
            ) : (
              <i className="fa-light fa-chevron-down absolute right-3 text-base-content/40 text-[10px] pointer-events-none"></i>
            )}
          </div>

          {/* Menú desplegable flotante con resultados */}
          {isOpen && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-base-100 rounded-xl border border-base-200 shadow-2xl z-50 max-h-60 overflow-y-auto divide-y divide-base-200">
              {/* Opción 1: Ninguno / Máxima Autoridad */}
              <div
                onClick={() => handleSelect("")}
                className={`p-2.5 hover:bg-primary/10 cursor-pointer flex items-center justify-between text-xs transition-colors ${
                  !value ? "bg-primary/5 text-primary font-bold" : "text-base-content"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200">
                    <i className="fa-light fa-crown text-xs"></i>
                  </div>
                  <div>
                    <span className="font-semibold block">
                      (Ninguno / Máxima Autoridad o Presidencia)
                    </span>
                    <span className="text-[10px] text-base-content/50 block">
                      Depende directamente de la máxima autoridad
                    </span>
                  </div>
                </div>
                {!value && <i className="fa-light fa-check text-primary text-sm"></i>}
              </div>

              {/* Lista filtrada de personas */}
              {filteredList.length === 0 ? (
                <div className="p-4 text-center text-xs text-base-content/50">
                  <i className="fa-light fa-user-slash text-lg mb-1 block"></i>
                  No se encontraron coincidencias para "{searchTerm}"
                </div>
              ) : (
                filteredList.map((sup) => {
                  const sName = formatDisplayName(sup?.Name, sup?.Email);
                  const isSelected = value === sup.objectId;
                  const lvlCfg = LEVEL_CONFIG[sup?.HierarchyLevel] || LEVEL_CONFIG["Especialista / Base"];

                  return (
                    <div
                      key={sup.objectId}
                      onClick={() => handleSelect(sup.objectId)}
                      className={`p-2.5 hover:bg-primary/10 cursor-pointer flex items-center justify-between text-xs transition-colors ${
                        isSelected ? "bg-primary/5 text-primary font-bold" : "text-base-content"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 border border-primary/20">
                          {(sName || "?").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold truncate">{sName}</span>
                            {sup?.HierarchyLevel && (
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded-full font-medium border ${lvlCfg.badgeClass}`}
                              >
                                {sup.HierarchyLevel}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-base-content/60 truncate">
                            {sup?.JobTitle || <span className="italic">Sin cargo</span>}
                            {sup?.Department ? ` • ${sup.Department}` : ""}
                          </div>
                        </div>
                      </div>

                      {isSelected && (
                        <i className="fa-light fa-check text-primary text-sm shrink-0 ml-2"></i>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {hint && (
        <span className="text-[10px] text-base-content/50 mt-1 block">
          {hint}
        </span>
      )}
    </div>
  );
};

export default SuperiorSearchSelect;
