import React, { useState, useEffect, useRef } from "react";
import AsyncSelect from "react-select/async";
import Tooltip from "../../../primitives/Tooltip";
import { useTranslation } from "react-i18next";
import { findContact } from "../../../constant/Utils";
import OrganigramaModal from "../OrganigramaModal";

function arrayMove(array, from, to) {
  array = array.slice();
  array.splice(to < 0 ? array.length + to : to, 0, array.splice(from, 1)[0]);
  return array;
}

export function formatDisplayName(raw, email) {
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

export function buildSignerLabel(item) {
  const name = formatDisplayName(item?.Name, item?.Email);
  const parts = [
    (name || "").trim(),
    (item?.JobTitle || "").trim(),
    (item?.Department || "").trim(),
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" - ");
  }
  return item?.Email || "Sin nombre";
}

const SignersInput = (props) => {
  const { t } = useTranslation();
  const [state, setState] = useState(undefined);
  const [selected, setSelected] = useState([]);
  const [isOrganigramaOpen, setIsOrganigramaOpen] = useState(false);
  const [allCorporateUsers, setAllCorporateUsers] = useState([]);
  const selectRef = useRef(null);

  // Cargar lista completa de contactos/usuarios corporativos para el organigrama y verificación
  useEffect(() => {
    loadAllUsers();
  }, []);

  const loadAllUsers = async () => {
    try {
      const contactRes = await findContact("");
      if (contactRes) {
        const filtered = JSON.parse(JSON.stringify(contactRes)).filter(
          (item) => (item?.Email || "").toLowerCase().trim() !== "admin@brascuba.cu"
        );
        setAllCorporateUsers(filtered);
      }
    } catch (e) {
      console.log("Error loading all users for organigrama:", e);
    }
  };

  useEffect(() => {
    // Para proporcionar datos iniciales si existen
    if (props?.initialData && props?.initialData?.length > 0) {
      const formatted = props.initialData.map((item) => ({
        value: item?.objectId,
        label: buildSignerLabel(item),
        email: item?.Email,
        Name: item?.Name,
        JobTitle: item?.JobTitle,
        Department: item?.Department,
        data: item,
      }));
      setSelected(formatted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (selectedOptions) => {
    if (selectedOptions && selectedOptions?.length > 0) {
      const hasAdmin = selectedOptions.some(
        (item) =>
          (item?.email || "").toLowerCase().trim() === "admin@brascuba.cu" ||
          (item?.label || "").toLowerCase().includes("admin@brascuba.cu")
      );
      if (hasAdmin) {
        alert("No se puede enviar a firmar al Administrador General.");
        selectedOptions = selectedOptions.filter(
          (item) =>
            (item?.email || "").toLowerCase().trim() !== "admin@brascuba.cu" &&
            !(item?.label || "").toLowerCase().includes("admin@brascuba.cu")
        );
      }
      setSelected(selectedOptions);
    } else {
      setSelected(selectedOptions || []);
    }
  };

  const onSortEnd = ({ oldIndex, newIndex }) => {
    const newValue = arrayMove(selected, oldIndex, newIndex);
    setSelected(newValue);
  };

  useEffect(() => {
    if (props.isReset && props.isReset === true) {
      setSelected([]);
    }
  }, [props.isReset]);

  useEffect(() => {
    if (selected) {
      let newData = [];
      selected.forEach((x) => {
        if (props?.isCaptureAllData) {
          newData.push(x);
        } else {
          newData.push(x.value);
        }
      });
      if (props.onChange) {
        props.onChange(newData);
      }
    }
    // eslint-disable-next-line
  }, [selected]);

  const loadOptions = async (inputValue) => {
    try {
      const contactRes = await findContact(inputValue);
      if (contactRes) {
        const res = JSON.parse(JSON.stringify(contactRes)).filter(
          (item) => (item?.Email || "").toLowerCase().trim() !== "admin@brascuba.cu"
        );

        // Detectar si hay nombres duplicados en los resultados
        const nameCounts = {};
        res.forEach((item) => {
          const n = (item.Name || "").trim().toLowerCase();
          if (n) nameCounts[n] = (nameCounts[n] || 0) + 1;
        });

        // Filtrar los que ya están en props.signersData si aplica
        const compareArrays = (list, signerObj) => {
          return list.filter(
            (item1) => !signerObj.find((item2) => item2.objectId === item1.objectId)
          );
        };

        const result = props?.signersData ? compareArrays(res, props?.signersData) : res;
        setState(result);

        return result.map((item) => {
          const isDuplicate =
            Boolean(item.Name) && (nameCounts[(item.Name || "").trim().toLowerCase()] || 0) > 1;

          return {
            label: buildSignerLabel(item),
            value: item.objectId,
            email: item.Email,
            Name: item.Name,
            JobTitle: item.JobTitle,
            Department: item.Department,
            isDuplicate,
            data: item,
            isChecked: true,
          };
        });
      }
    } catch (error) {
      console.log("err", error);
      return [];
    }
  };

  // Alternar usuario desde el Organigrama
  const handleToggleFromOrganigrama = (user) => {
    if ((user?.Email || "").toLowerCase().trim() === "admin@brascuba.cu") {
      alert("No se puede enviar a firmar al Administrador General.");
      return;
    }

    const exists = selected.some(
      (s) => s.value === user.objectId || (s.email && s.email.toLowerCase() === (user.Email || "").toLowerCase())
    );

    if (exists) {
      // Quitar de la selección
      setSelected((prev) =>
        prev.filter(
          (s) => s.value !== user.objectId && s.email?.toLowerCase() !== (user.Email || "").toLowerCase()
        )
      );
    } else {
      // Agregar a la selección
      const newOption = {
        value: user.objectId,
        label: buildSignerLabel(user),
        email: user.Email,
        Name: user.Name,
        JobTitle: user.JobTitle,
        Department: user.Department,
        data: user,
      };
      setSelected((prev) => [...prev, newOption]);
    }
  };

  return (
    <div className="text-xs mt-2">
      <div className="flex items-center justify-between mb-1">
        <label className="block relative font-semibold text-base-content">
          {props.label ? props.label : t("signers")}
          {props.required && <span className="text-red-500 text-[13px] ml-0.5">*</span>}
          <span className={`z-[${props?.zindex ? props.zindex : 30}] absolute ml-1 text-xs`}>
            <Tooltip
              id={
                props.tooltipId ||
                `${props.label ? String(props.label).replace(/[^a-zA-Z0-9]/g, "_") : "signers"}-tooltip`
              }
              message={props.helpText ? props.helpText : t("signers-help")}
              maxWidth="max-w-[360px]"
            />
          </span>
        </label>

        {/* Botón Ver Organigrama */}
        <button
          type="button"
          onClick={() => {
            loadAllUsers();
            setIsOrganigramaOpen(true);
          }}
          className="op-btn op-btn-ghost op-btn-xs text-primary hover:bg-primary/10 flex items-center gap-1 font-semibold"
          title="Ver organigrama agrupado por departamentos"
        >
          <i className="fa-light fa-sitemap text-xs"></i>
          <span>{t("view-organigrama", { defaultValue: "Ver organigrama" })}</span>
        </button>
      </div>

      <div className="flex gap-x-[5px]">
        <div className={`w-full z-[${props?.zindex ? props.zindex : 40}]`}>
          <AsyncSelect
            ref={selectRef}
            onSortEnd={onSortEnd}
            distance={4}
            isMulti
            cacheOptions
            defaultOptions
            placeholder={
              props.placeholder ||
              t("select-contact-placeholder", {
                defaultValue: "Buscar por nombre, cargo, departamento o correo...",
              })
            }
            options={state || []}
            value={selected}
            onChange={onChange}
            closeMenuOnSelect={false}
            required={props.required && (!selected || selected.length === 0)}
            loadingMessage={() => t("loading")}
            noOptionsMessage={() => t("contact-not-found")}
            loadOptions={loadOptions}
            onFocus={() => loadOptions("")}
            filterOption={(option, rawInput) => {
              if (!rawInput) return true;
              const term = rawInput.toLowerCase().trim();
              const name = (option.data?.Name || "").toLowerCase();
              const job = (option.data?.JobTitle || "").toLowerCase();
              const dept = (option.data?.Department || "").toLowerCase();
              const email = (option.data?.email || option.data?.Email || "").toLowerCase();
              return (
                name.includes(term) ||
                job.includes(term) ||
                dept.includes(term) ||
                email.includes(term)
              );
            }}
            formatOptionLabel={(option, { context }) => {
              const displayLabel = option.label || buildSignerLabel(option.data || option);
              if (context === "value") {
                return (
                  <span className="!text-white text-white font-medium text-[11px] truncate max-w-[280px]">
                    {displayLabel}
                  </span>
                );
              }
              return (
                <div className="flex flex-col py-0.5">
                  <span className="font-medium text-xs text-base-content">{displayLabel}</span>
                  {option.isDuplicate && (
                    <span className="text-[10px] text-base-content/60 italic">
                      {option.email}
                    </span>
                  )}
                </div>
              );
            }}
            unstyled
            styles={{
              multiValue: (base) => ({
                ...base,
                backgroundColor: "#002B49",
                color: "#ffffff",
                borderRadius: "0.375rem",
              }),
              multiValueLabel: (base) => ({
                ...base,
                color: "#ffffff",
                fontWeight: "500",
              }),
              multiValueRemove: (base) => ({
                ...base,
                color: "#ffffff",
                cursor: "pointer",
                ":hover": {
                  backgroundColor: "rgba(255, 255, 255, 0.2)",
                  color: "#ffffff",
                },
              }),
            }}
            classNames={{
              control: () =>
                "op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full h-full text-[11px] min-h-[34px]",
              valueContainer: () =>
                "flex flex-row flex-wrap gap-1 w-full my-[2px] items-center",
              multiValue: () =>
                "!bg-primary !text-white h-auto py-1 px-2.5 text-[11px] gap-1.5 shadow-sm inline-flex items-center rounded-md font-medium",
              multiValueLabel: () =>
                "!text-white font-medium truncate max-w-[240px]",
              multiValueRemove: () =>
                "!text-white hover:bg-white/20 rounded-full p-0.5 cursor-pointer ml-1 inline-flex items-center justify-center",
              menu: () => "mt-1 shadow-lg rounded-lg bg-base-200 text-base-content z-50 border border-base-300",
              menuList: () => "shadow-md rounded-lg overflow-hidden max-h-60 p-1",
              option: () =>
                "bg-base-200 text-base-content rounded-md m-0.5 hover:bg-base-300 p-2 cursor-pointer transition-colors",
              noOptionsMessage: () => "p-2 bg-base-200 rounded-lg text-base-content/60",
            }}
          />
        </div>
      </div>

      {/* Modal de Organigrama */}
      <OrganigramaModal
        isOpen={isOrganigramaOpen}
        handleClose={() => setIsOrganigramaOpen(false)}
        allUsers={allCorporateUsers}
        selected={selected}
        onToggleUser={handleToggleFromOrganigrama}
      />
    </div>
  );
};

export default SignersInput;
