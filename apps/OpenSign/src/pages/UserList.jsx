import React, { useEffect, useState } from "react";
import Parse from "parse";
import Alert from "../primitives/Alert";
import Loader from "../primitives/Loader";
import { useLocation, useNavigate } from "react-router";
import ModalUi from "../primitives/ModalUi";
import pad from "../assets/images/pad.svg";
import Tooltip from "../primitives/Tooltip";
import AddUser from "../components/AddUser";
import {
  useTranslation
} from "react-i18next";
import DeleteUserModal from "../primitives/DeleteUserModal";
import axios from "axios";
import PasswordResetModal from "../primitives/PasswordResetModal";
import { usersActions } from "../json/ReportJson";
import { withSessionValidation } from "../utils";

const heading = ["Sr.No", "Name", "Email", "Phone", "Role", "Team", "Active"];
const UserList = () => {
  const { t } = useTranslation();
  const [userList, setUserList] = useState([]);
  const [isLoader, setIsLoader] = useState(false);
  const [isModal, setIsModal] = useState({
    form: false,
    addseats: false,
    options: false
  });
  const location = useLocation();
  const isDashboard =
    location?.pathname === "/dashboard/35KBoSgoAK" ? true : false;
  const [currentPage, setCurrentPage] = useState(1);
  const navigate = useNavigate();
  const [isAlert, setIsAlert] = useState({ type: "success", msg: "" });
  const [isActiveModal, setIsActiveModal] = useState({});
  const [isActLoader, setIsActLoader] = useState({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [formHeader, setFormHeader] = useState(t("add-user"));
  const [deleteUserRes, setDeleteUserRes] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [isActModal, setIsActModal] = useState({});
  const Extand_Class = localStorage.getItem("Extand_Class");
  const extClass = Extand_Class && JSON.parse(Extand_Class);

  const checkIsSuperAdmin = (u) => {
    if (!u) return false;
    return (
      u.isSuperAdmin === true ||
      u.Email === "admin@brascuba.cu" ||
      u.email === "admin@brascuba.cu" ||
      u.UserId?.isSuperAdmin === true ||
      u.UserId?.email === "admin@brascuba.cu"
    );
  };
  const [isSuperAdmin, setIsSuperAdmin] = useState(() => checkIsSuperAdmin(extClass?.[0]));

  const recordperPage = 10;
  const startIndex = (currentPage - 1) * recordperPage; // user per page

  const getPaginationRange = () => {
    const totalPageNumbers = 7; // Adjust this value to show more/less page numbers
    const pages = [];
    const totalPages = Math.ceil(userList.length / recordperPage);
    if (totalPages <= totalPageNumbers) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      const leftSiblingIndex = Math.max(currentPage - 1, 1);
      const rightSiblingIndex = Math.min(currentPage + 1, totalPages);

      const showLeftDots = leftSiblingIndex > 2;
      const showRightDots = rightSiblingIndex < totalPages - 2;

      const firstPageIndex = 1;
      const lastPageIndex = totalPages;

      if (!showLeftDots && showRightDots) {
        let leftItemCount = 3;
        let leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);

        pages.push(...leftRange);
        pages.push("...");
        pages.push(totalPages);
      } else if (showLeftDots && !showRightDots) {
        let rightItemCount = 3;
        let rightRange = Array.from(
          { length: rightItemCount },
          (_, i) => totalPages - rightItemCount + i + 1
        );

        pages.push(firstPageIndex);
        pages.push("...");
        pages.push(...rightRange);
      } else if (showLeftDots && showRightDots) {
        let middleRange = Array.from(
          { length: 3 },
          (_, i) => leftSiblingIndex + i
        );

        pages.push(firstPageIndex);
        pages.push("...");
        pages.push(...middleRange);
        pages.push("...");
        pages.push(lastPageIndex);
      }
    }
    return pages;
  };
  const pageNumbers = getPaginationRange();
  // to slice out 10 objects from array for current page
  const indexOfLastDoc = currentPage * recordperPage;
  const indexOfFirstDoc = indexOfLastDoc - recordperPage;
  const currentList = userList?.slice(indexOfFirstDoc, indexOfLastDoc);
  useEffect(() => {
    fetchUserList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function fetchUserList() {
    try {
      setIsLoader(true);
      const extUser =
        localStorage.getItem("Extand_Class") &&
        JSON.parse(localStorage.getItem("Extand_Class"))?.[0];

      if (extUser) {
        const admin = extUser?.UserRole === "contracts_Admin";
        setIsAdmin(admin);
        const superAdmin = checkIsSuperAdmin(extUser);
        setIsSuperAdmin(superAdmin);
        if (!admin) {
          navigate("/dashboard/35KBoSgoAK");
          return;
        }
      }
      const res = await Parse.Cloud.run("getuserlistbyorg", {
        organizationId: extUser.OrganizationId.objectId
      });
      const _userRes = JSON.parse(JSON.stringify(res));
      setUserList(_userRes);
    } catch (err) {
      console.log("Err in fetch userlist", err);
      showAlert("danger", t("something-went-wrong-mssg"));
    } finally {
      setIsLoader(false);
    }
  }
  const handleModal = (modalName) => {
    setIsModal((obj) => ({ ...obj, [modalName]: !obj[modalName] }));
  };

  // Change page
  const paginateFront = () => {
    const lastValue = pageNumbers?.[pageNumbers?.length - 1];
    if (currentPage < lastValue) {
      setCurrentPage(currentPage + 1);
    }
  };

  const paginateBack = () => {
    if (startIndex > 0) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleUserData = (userData) => {
    if (userData) {
      setUserList((prev) => [userData, ...prev]);
    }
  };
  // `formatRow` is used to show data in poper manner like
  // if data is of array type then it will join array items with ","
  // if data is of object type then it Name values will be show in row
  // if no data available it will show hyphen "-"
  const formatRow = (row) => {
    if (Array.isArray(row)) {
      let updateArr = row.map((x) => x.Name);
      return updateArr.join(", ");
    } else if (typeof row === "object" && row !== null) {
      return row?.Name || "-";
    } else {
      return "-";
    }
  };
  const handleClose = () => setIsActiveModal({});

  const handleToggleSubmit = withSessionValidation(async (user) => {
    const index = userList.findIndex((obj) => obj.objectId === user.objectId);
    if (index !== -1) {
      setIsActiveModal({});
      setIsActLoader({ [user.objectId]: true });
      const newArray = [...userList];
      const IsDisabled = newArray[index]?.IsDisabled;
      newArray[index] = { ...newArray[index], IsDisabled: !IsDisabled };
      setUserList(newArray);
      try {
        const extUser = new Parse.Object("contracts_Users");
        extUser.id = user.objectId;
        extUser.set("IsDisabled", !IsDisabled);
        await extUser.save();
        showAlert(
          !IsDisabled === true ? "danger" : "success",
          !IsDisabled === true ? t("user-deactivated") : t("user-activated")
        );
      } catch (err) {
        showAlert("danger", t("something-went-wrong-mssg"));
        console.log("err in disable team", err);
      } finally {
        setIsActLoader({});
      }
    }
  });
  const handleToggleBtn = (user) => {
    setIsActiveModal({ [user.objectId]: true });
  };

  // `showAlert` handle show/hide alert
  const showAlert = (type, msg, timer = 1500) => {
    setIsAlert({ type, msg });
    setTimeout(() => setIsAlert({ type: "success", msg: "" }), timer);
  };

  const handleDeleteAccount = withSessionValidation(async (item) => {
    setDeleting(true);
    if (item?.UserId?.objectId) {
      const url = localStorage.getItem("baseUrl")?.replace(/\/app\/?$/, "/");
      const deleteUrl = `${url}deleteuser/${item.UserId.objectId}`;
      try {
        await axios.post(deleteUrl, null, {
          headers: { sessiontoken: localStorage.getItem("accesstoken") }
        });
        setUserList((prev) =>
          prev.filter((user) => user.objectId !== item.objectId)
        );
        showAlert("success", t("user-deleted-successfully"));
      } catch (err) {
        const message = err?.response?.data?.message || err?.message;
        setDeleteUserRes(message);
        showAlert("danger", message);
        console.log("Err in deleteuser acc", err);
      } finally {
        setDeleting(false);
      }
    } else {
      showAlert("danger", t("something-went-wrong-mssg"));
      setDeleteUserRes(t("something-went-wrong-mssg"));
      setDeleting(false);
    }
  });
  const handleCloseModal = () => {
    setIsActModal({});
    setDeleteUserRes("");
    setDeleting(false);
  };

  const handleActionBtn = withSessionValidation(async (act, item) => {
      setIsActModal({ [`${act.action}_${item.objectId}`]: true });
  });
  const handleBtnVisibility = (act, item) => {
    if (!isSuperAdmin) {
      return false;
    }
    if (checkIsSuperAdmin(item)) {
      return false;
    }
    if (item?.objectId === extClass?.[0]?.objectId) {
      return false;
    }
    return true;
  };
  const handleActiveToggleVisibility = (item) => {
    if (!isSuperAdmin) {
      return false;
    }
    if (checkIsSuperAdmin(item)) {
      return false;
    }
    if (item?.objectId === extClass?.[0]?.objectId) {
      return false;
    }
    return true;
  };

  const submitPassword = withSessionValidation(async (userId, password) => {
    setIsLoader(true);
    setIsActModal({});
    try {
      const params = { userId, password };
      await Parse.Cloud.run("resetpassword", params);
      showAlert("success", t("password-has-been-reset"));
    } catch (err) {
      console.log("err while reset password", err);
      showAlert("danger", t(err.message), 2000);
    } finally {
      setIsLoader(false);
    }
  });

  const handleToggleUserRole = withSessionValidation(async (item) => {
    if (!isSuperAdmin) {
      showAlert("danger", "Solo el Administrador Principal puede otorgar o revocar privilegios.");
      return;
    }
    if (checkIsSuperAdmin(item)) {
      showAlert("danger", "No se pueden modificar los privilegios del Administrador Principal.");
      return;
    }
    const isCurrentAdmin = item?.UserRole === "contracts_Admin";
    const newRole = isCurrentAdmin ? "contracts_User" : "contracts_Admin";
    const confirmMsg = isCurrentAdmin
      ? `¿Está seguro de que desea revocar los privilegios de Administrador a ${item?.Name || item?.Email}?`
      : `¿Está seguro de que desea promover a ${item?.Name || item?.Email} como Administrador?`;

    if (!window.confirm(confirmMsg)) return;

    setIsLoader(true);
    try {
      await Parse.Cloud.run("updateuserrole", {
        targetUserId: item.objectId,
        newRole: newRole
      });
      setUserList((prev) =>
        prev.map((user) =>
          user.objectId === item.objectId ? { ...user, UserRole: newRole } : user
        )
      );
      showAlert(
        "success",
        newRole === "contracts_Admin"
          ? "Usuario promovido a Administrador con éxito."
          : "Privilegios de Administrador revocados con éxito."
      );
    } catch (err) {
      console.error("Error updating user role:", err);
      showAlert("danger", err?.message || "No se pudo actualizar el rol del usuario.");
    } finally {
      setIsLoader(false);
    }
  });
  return (
    <div className="relative">
      {isLoader && (
        <div className="absolute w-full h-[300px] md:h-[400px] flex justify-center items-center z-30 rounded-box">
          <Loader />
        </div>
      )}
      {Object.keys(isActLoader)?.length > 0 && (
        <div className="absolute w-full h-full flex justify-center items-center bg-black/30 z-30 rounded-box">
          <Loader />
        </div>
      )}

      {
          !isLoader && (
            <>
              {isAdmin ? (
                <div className="p-2 w-full bg-base-100 text-base-content op-card shadow-lg">
                  {isAlert.msg && (
                    <Alert type={isAlert.type}>{isAlert.msg}</Alert>
                  )}
                  <div className="flex flex-row items-center justify-between my-2 mx-3 text-[20px] md:text-[23px]">
                    <div className="font-light">
                      {t("report-name.Users")}{" "}
                      <span className="text-xs md:text-[13px] font-normal">
                        <Tooltip message={t("users-from-teams")} />
                      </span>
                    </div>
                    {isSuperAdmin && (
                      <div className="flex flex-row gap-2 items-center">
                        <div
                          className="cursor-pointer"
                          onClick={() => handleModal("form")}
                        >
                          <i className="fa-light fa-square-plus text-accent text-[30px] md:text-[40px]"></i>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="w-full overflow-x-auto">
                    <table className="op-table border-collapse w-full mb-[50px]">
                      <thead className="text-[14px]">
                        <tr className="border-y-[1px]">
                          {heading?.map((item, index) => (
                            <th key={index} className="px-4 py-2">
                              {t(`report-heading.${item}`)}
                            </th>
                          ))}
                          {usersActions?.length > 0 && isSuperAdmin && (
                            <th className="p-2 text-transparent pointer-events-none">
                              {t("action")}
                            </th>
                          )}
                        </tr>
                      </thead>
                      {userList?.length > 0 && (
                        <tbody className="text-[12px]">
                          {currentList.map((item, index) => (
                            <tr className="border-y-[1px]" key={index}>
                              {heading.includes("Sr.No") && (
                                <th className="px-4 py-2">
                                  {startIndex + index + 1}
                                </th>
                              )}
                              <td className="px-4 py-2 font-semibold">
                                {item?.Name}{" "}
                              </td>
                              <td className="px-4 py-2 ">
                                {item?.Email || "-"}
                              </td>
                              <td className="px-4 py-2">
                                {item?.Phone || "-"}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap">
                                <span
                                  className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                    item?.UserRole === "contracts_Admin"
                                      ? "bg-blue-100 text-blue-800 border border-blue-200"
                                      : "bg-gray-100 text-gray-700"
                                  }`}
                                >
                                  {item?.UserRole === "contracts_Admin"
                                    ? "Administrador"
                                    : "Usuario"}
                                </span>
                                {isSuperAdmin && !checkIsSuperAdmin(item) && item?.objectId !== extClass?.[0]?.objectId && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleUserRole(item)}
                                    className="ml-2 op-btn op-btn-xs op-btn-outline"
                                    title={
                                      item?.UserRole === "contracts_Admin"
                                        ? "Quitar privilegios de Administrador"
                                        : "Promover a Administrador"
                                    }
                                  >
                                    <i
                                      className={`fa-light ${
                                        item?.UserRole === "contracts_Admin"
                                          ? "fa-user-minus text-error"
                                          : "fa-user-shield text-primary"
                                      }`}
                                      aria-hidden="true"
                                    ></i>
                                    <span className="hidden xl:inline ml-1">
                                      {item?.UserRole === "contracts_Admin"
                                        ? "Quitar Admin"
                                        : "Hacer Admin"}
                                    </span>
                                  </button>
                                )}
                              </td>
                              <td className="px-4 py-2">
                                {formatRow(item.TeamIds)}
                              </td>
                              {handleActiveToggleVisibility(item) ? (
                                <td className="px-4 py-2 font-semibold">
                                  <label
                                    htmlFor={`isdisabled-${item.objectId}`}
                                    className="cursor-pointer relative block items-center mb-0"
                                  >
                                    <input
                                      id={`isdisabled-${item.objectId}`}
                                      type="checkbox"
                                      className="op-toggle checked:[--tglbg:#3368ff] transition-all checked:text-white"
                                      checked={item?.IsDisabled !== true}
                                      onChange={() => handleToggleBtn(item)}
                                    />
                                  </label>
                                  {isActiveModal[item.objectId] && (
                                    <ModalUi
                                      isOpen
                                      title={t("user-status")}
                                      handleClose={handleClose}
                                    >
                                      <div className="m-[20px]">
                                        <div className="text-lg font-normal text-base-content">
                                          {t("are-you-sure")}{" "}
                                          {item?.IsDisabled
                                            ? t("activate")
                                            : t("deactivate")}{" "}
                                          {t("this-user")}?
                                        </div>
                                        <hr className="bg-[#ccc] mt-4 " />
                                        <div className="flex items-center mt-3 gap-2 text-white">
                                          <button
                                            onClick={() =>
                                              handleToggleSubmit(item)
                                            }
                                            className="op-btn op-btn-primary"
                                          >
                                            {t("yes")}
                                          </button>
                                          <button
                                            onClick={handleClose}
                                            className="op-btn op-btn-secondary"
                                          >
                                            {t("no")}
                                          </button>
                                        </div>
                                      </div>
                                    </ModalUi>
                                  )}
                                </td>
                              ) : (
                                <td className="px-4 py-2 font-semibold">
                                  <span
                                    className={`px-2 py-0.5 rounded text-xs ${
                                      item?.IsDisabled
                                        ? "bg-red-100 text-red-800 border border-red-200"
                                        : "bg-green-100 text-green-800 border border-green-200"
                                    }`}
                                  >
                                    {item?.IsDisabled ? "Inactivo" : "Activo"}
                                  </span>
                                </td>
                              )}

                              {isAdmin && isSuperAdmin && (
                                <td className="px-3 py-2">
                                  <div className="text-base-content min-w-max flex flex-row gap-x-2 gap-y-1 justify-start items-center">
                                    {usersActions?.length > 0 &&
                                      usersActions?.map((act, index) => (
                                        <React.Fragment key={index}>
                                          {handleBtnVisibility(act, item) && (
                                            <div
                                              role="button"
                                              data-tut={act?.selector}
                                              onClick={() =>
                                                handleActionBtn(act, item)
                                              }
                                              title={t(
                                                `btnLabel.${act.hoverLabel}`
                                              )}
                                              className={
                                                act.action !== "option"
                                                  ? `${act?.btnColor || ""} op-btn op-btn-sm mr-1 `
                                                  : "text-base-content focus:outline-none text-lg mr-2 relative"
                                              }
                                            >
                                              <i className={act.btnIcon}></i>
                                              {act.btnLabel && (
                                                <span className="uppercase font-medium">
                                                  {t(
                                                    `btnLabel.${act.btnLabel}`
                                                  )}
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </React.Fragment>
                                      ))}
                                  </div>
                                </td>
                              )}
                              <DeleteUserModal
                                title={t("delete-account")}
                                deleting={deleting}
                                userEmail={item?.Email}
                                isOpen={isActModal["delete_" + item.objectId]}
                                onConfirm={() => handleDeleteAccount(item)}
                                deleteRes={deleteUserRes}
                                handleClose={handleCloseModal}
                              />
                              <PasswordResetModal
                                isOpen={
                                  isActModal["resetpassword_" + item.objectId]
                                }
                                userId={item?.UserId?.objectId}
                                onClose={handleCloseModal}
                                onSubmit={submitPassword}
                                showAlert={showAlert}
                              />
                            </tr>
                          ))}
                        </tbody>
                      )}
                    </table>
                  </div>
                  <div className="flex flex-row justify-between items-center text-xs font-medium">
                    <div className="op-join flex flex-wrap items-center p-2">
                      {userList.length > recordperPage && (
                        <button
                          onClick={() => paginateBack()}
                          className="op-join-item op-btn op-btn-sm"
                        >
                          {t("prev")}
                        </button>
                      )}
                      {pageNumbers.map((x, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentPage(x)}
                          disabled={x === "..."}
                          className={`${
                            x === currentPage ? "op-btn-active" : ""
                          } op-join-item op-btn op-btn-sm`}
                        >
                          {x}
                        </button>
                      ))}
                      {userList.length > recordperPage && (
                        <button
                          onClick={() => paginateFront()}
                          className="op-join-item op-btn op-btn-sm"
                        >
                          {t("next")}
                        </button>
                      )}
                    </div>
                  </div>
                  {userList?.length <= 0 && (
                    <div
                      className={`${
                        isDashboard ? "h-[317px]" : ""
                      } flex flex-col items-center justify-center w-ful bg-base-100 text-base-content rounded-xl py-4`}
                    >
                      <div className="w-[60px] h-[60px] overflow-hidden">
                        <img
                          className="w-full h-full object-contain"
                          src={pad}
                          alt="img"
                        />
                      </div>
                      <div className="text-sm font-semibold">
                        {t("no-data-available")}
                      </div>
                    </div>
                  )}
                  <ModalUi
                    isOpen={isModal.form}
                    title={formHeader}
                    handleClose={() => handleModal("form")}
                  >
                    <AddUser
                      showAlert={showAlert}
                      handleUserData={handleUserData}
                      closePopup={() => handleModal("form")}
                      setFormHeader={setFormHeader}
                    />
                  </ModalUi>
                </div>
              ) : (
                <div className="flex items-center justify-center h-screen w-full bg-base-100 text-base-content rounded-box">
                  <div className="text-center">
                    <h1 className="text-[60px] lg:text-[120px] font-semibold">
                      404
                    </h1>
                    <p className="text-[30px] lg:text-[50px]">
                      {t("page-not-found")}
                    </p>
                  </div>
                </div>
              )}
            </>
          )
      }
    </div>
  );
};

export default UserList;
