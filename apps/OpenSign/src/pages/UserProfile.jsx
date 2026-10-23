import React, {
  useState,
  useEffect,
} from "react";
import { Navigate, useNavigate } from "react-router";
import Parse from "parse";
import { SaveFileSize } from "../constant/saveFileSize";
import dp from "../assets/images/dp.png";
import {
  compressImage,
  sanitizeFileName,
  withSessionValidation
} from "../utils";
import axios from "axios";
import Tooltip from "../primitives/Tooltip";
import {
  getSecureUrl
} from "../constant/Utils";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";

function UserProfile() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  let UserProfile =
    localStorage.getItem("UserInformation") &&
    JSON.parse(localStorage.getItem("UserInformation"));
  let extendUser =
    localStorage.getItem("Extand_Class") &&
    JSON.parse(localStorage.getItem("Extand_Class"));
  const [parseBaseUrl] = useState(localStorage.getItem("baseUrl"));
  const [parseAppId] = useState(localStorage.getItem("parseAppId"));
  const [editmode, setEditMode] = useState(false);
  const [name, SetName] = useState(localStorage.getItem("username"));
  const [Phone, SetPhone] = useState(UserProfile && UserProfile.phone);
  const [Image, setImage] = useState(localStorage.getItem("profileImg"));
  const [isLoader, setIsLoader] = useState(false);
  const [percentage, setpercentage] = useState(0);
  const [company, setCompany] = useState(
    extendUser && extendUser?.[0]?.Company
  );
  const [jobTitle, setJobTitle] = useState(
    extendUser && extendUser?.[0]?.JobTitle
  );
  useEffect(() => {
    getUserDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const getUserDetail = async () => {
    setIsLoader(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    let phn = Phone,
      res = "";
    if (!res) {
      setIsLoader(true);
      try {
        const userQuery = Parse.Object.extend("_User");
        const query = new Parse.Query(userQuery);
        await query.get(UserProfile.objectId).then((object) => {
          object.set("name", name);
          object.set("ProfilePic", Image);
          object.set("phone", phn || "");
          object.save().then(
            async (response) => {
              if (response) {
                let res = response.toJSON();
                let rr = JSON.stringify(res);
                localStorage.setItem("UserInformation", rr);
                SetName(res.name);
                SetPhone(res?.phone || "");
                setImage(res.ProfilePic);
                localStorage.setItem("username", res.name);
                localStorage.setItem("profileImg", res.ProfilePic);
                await updateExtUser({
                  Name: res.name,
                  Phone: res?.phone || ""
                });
                alert(t("profile-update-alert"));
                setEditMode(false);
                setIsLoader(false);
                //navigate("/dashboard/35KBoSgoAK");
              }
            },
            (error) => {
              alert(t("something-went-wrong-mssg"));
              console.error("Error while updating tour", error);
              setIsLoader(false);
            }
          );
        });
      } catch (error) {
        console.log("err", error);
      }
    }
  };

  //  `updateExtUser` is used to update user details in extended class
  const updateExtUser = withSessionValidation(async (obj) => {
    try {
      const extData = JSON.parse(localStorage.getItem("Extand_Class"));
      const ExtUserId = extData?.[0]?.objectId;
      const body = {
        Phone: obj?.Phone || "",
        Name: obj.Name,
        JobTitle: jobTitle,
        Company: company,
        Language: obj?.language || "",
      };

      await axios.put(
        parseBaseUrl + "classes/contracts_Users/" + ExtUserId,
        body,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Parse-Application-Id": parseAppId,
            "X-Parse-Session-Token": localStorage.getItem("accesstoken")
          }
        }
      );
      const res = await Parse.Cloud.run("getUserDetails");

      const json = JSON.parse(JSON.stringify([res]));
      const extRes = JSON.stringify(json);
      localStorage.setItem("Extand_Class", extRes);
    } catch (err) {
      console.log("error in save data in contracts_Users class", err);
    }
  });
  // file upload function
  const fileUpload = async (event) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const compressedfile = await compressImage(
        file,
        { width: 200, height: 200 },
        "file"
      );
      await handleFileUpload(compressedfile);
    }
  };

  const handleFileUpload = async (file) => {
    const size = file.size;
    const pdfFile = file;
    const fileName = file.name;
    const name = sanitizeFileName(fileName);
    const parseFile = new Parse.File(name, pdfFile);

    try {
      const response = await parseFile.save({
        progress: (progressValue, loaded, total) => {
          if (progressValue !== null) {
            const percentCompleted = Math.round((loaded * 100) / total);
            // console.log("percentCompleted ", percentCompleted);
            setpercentage(percentCompleted);
          }
        }
      });
      // // The response object will contain information about the uploaded file
      // console.log("File uploaded:", response);

      if (response?.url()) {
        const fileRes = await getSecureUrl(response?.url());
        if (fileRes?.url) {
          setImage(fileRes?.url);
          setpercentage(0);
          const tenantId = localStorage.getItem("TenantId");
          const userId = extendUser?.[0]?.UserId?.objectId;
          SaveFileSize(size, fileRes?.url, tenantId, userId);
          return fileRes?.url;
        }
      }
    } catch (error) {
      console.error("Error uploading file:", error);
    }
  };
  if (
    localStorage.getItem("accesstoken") === null &&
    localStorage.getItem("pageType") === null
  ) {
    let _redirect = `/`;
    return <Navigate to={_redirect} />;
  }


  const handleCancel = () => {
    setEditMode(false);
    SetName(localStorage.getItem("username"));
    SetPhone(UserProfile && UserProfile.phone);
    setImage(localStorage.getItem("profileImg"));
    setCompany(extendUser && extendUser?.[0]?.Company);
    setJobTitle(extendUser?.[0]?.JobTitle);
  };


  return (
    <React.Fragment>
      {isLoader ? (
        <div className="h-[100vh] flex justify-center items-center">
          <Loader />
        </div>
      ) : (
        <div className="flex justify-center items-center w-full relative">
          <div className="bg-base-100 text-base-content flex flex-col justify-center shadow-md rounded-box w-[450px]">
            <div className="flex flex-col justify-center items-center my-4">
              <div className="w-[200px] h-[200px] overflow-hidden rounded-full">
                <img
                  className="object-contain w-full h-full"
                  src={Image === "" ? dp : Image}
                  alt="dp"
                />
              </div>
              {editmode && (
                <input
                  type="file"
                  className="op-file-input op-file-input-bordered op-file-input-sm max-w-[270px] mt-4 text-sm"
                  accept="image/png, image/gif, image/jpeg"
                  onChange={fileUpload}
                />
              )}
              {percentage !== 0 && (
                <div className="flex items-center gap-x-2">
                  <div className="h-2 rounded-full w-[200px] md:w-[400px] bg-gray-200">
                    <div
                      className="h-2 rounded-full bg-blue-500"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                  <span className="text-base-contentk text-sm">
                    {percentage}%
                  </span>
                </div>
              )}
              <div className="text-base font-semibold pt-4">
                {localStorage.getItem("_user_role")}
              </div>
            </div>
            <ul className="w-full flex flex-col p-2 text-sm">
              <li
                className={`flex justify-between items-center border-y-[1px] border-gray-300 break-all ${
                  editmode ? "py-1.5" : "py-2"
                }`}
              >
                <span className="font-semibold">{t("name")}:</span>{" "}
                {editmode ? (
                  <input
                    type="text"
                    value={name}
                    className="op-input op-input-bordered op-input-sm w-[180px] focus:outline-none hover:border-base-content text-sm"
                    onChange={(e) => SetName(e.target.value)}
                  />
                ) : (
                  <span>{localStorage.getItem("username")}</span>
                )}
              </li>
              <li
                className={`flex justify-between items-center border-b-[1px] border-gray-300 break-all ${
                  editmode ? "py-1.5" : "py-2"
                }`}
              >
                <span className="font-semibold">{t("phone")}:</span>{" "}
                {editmode ? (
                  <input
                    type="text"
                    className="op-input op-input-bordered op-input-sm w-[180px] focus:outline-none hover:border-base-content text-sm"
                    onChange={(e) => SetPhone(e.target.value)}
                    value={Phone}
                  />
                ) : (
                  <span>{UserProfile && UserProfile.phone}</span>
                )}
              </li>
              <li className="flex justify-between items-center border-b-[1px] border-gray-300 py-2 break-all">
                <span
                  data-tooltip-id="email-tooltip"
                  className="font-semibold flex gap-1"
                >
                  {t("email")} :{" "}
                  {editmode && (
                    <Tooltip
                      message={t("email-help")}
                      maxWidth="max-w-[250px]"
                    />
                  )}
                </span>
                <span>{UserProfile && UserProfile.email}</span>
              </li>
              {/* <li
                className={`flex justify-between items-center border-b-[1px] border-gray-300 break-all ${
                  editmode ? "py-1.5" : "py-2"
                }`}
              >
                <span className="font-semibold">{t("company")}:</span>{" "}
                {editmode ? (
                  <input
                    type="text"
                    value={company}
                    className="op-input op-input-bordered op-input-sm w-[180px] focus:outline-none hover:border-base-content text-sm"
                    onChange={(e) => setCompany(e.target.value)}
                  />
                ) : (
                  <span>{extendUser?.[0].Company}</span>
                )}
              </li> */}
              <li
                className={`flex justify-between items-center border-b-[1px] border-gray-300 break-all ${
                  editmode ? "py-1.5" : "py-2"
                }`}
              >
                <span className="font-semibold">{t("job-title")}:</span>{" "}
                {editmode ? (
                  <input
                    type="text"
                    value={jobTitle}
                    className="op-input op-input-bordered op-input-sm w-[180px] focus:outline-none hover:border-base-content text-sm"
                    onChange={(e) => setJobTitle(e.target.value)}
                  />
                ) : (
                  <span>{extendUser?.[0]?.JobTitle}</span>
                )}
              </li>
            </ul>
            <div className="flex flex-col md:flex-row justify-center gap-2 pt-2 pb-3 md:pt-3 md:pb-4 mx-2 md:mx-0">
              <button
                type="button"
                onClick={(e) => {
                    editmode ? handleSubmit(e) : setEditMode(true);
                }}
                className="op-btn op-btn-primary md:w-[100px]"
              >
                {editmode ? t("save") : t("edit")}
              </button>
              <button
                type="button"
                onClick={() =>
                  editmode ? handleCancel() : navigate("/changepassword")
                }
                className={
                      `op-btn ${editmode ? "op-btn-ghost w-[100px]" : "op-btn-secondary"}`
                }
              >
                {editmode ? t("cancel") : t("change-password")}
              </button>
            </div>
          </div>
        </div>
      )}
    </React.Fragment>
  );
}

export default UserProfile;
