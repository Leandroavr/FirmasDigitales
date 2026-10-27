import { useState, useEffect } from "react";
import Parse from "parse";
import { Outlet } from "react-router";
import SessionExpiredModal from "./SessionExpiredModal";

const Validate = () => {
  const [isUserValid, setIsUserValid] = useState(true);
  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("accesstoken");
      if (token) {
        try {
          let currentUser = Parse.User.current();
          if (!currentUser) {
            currentUser = await Parse.User.become(token);
          } else {
            const userQuery = new Parse.Query(Parse.User);
            await userQuery.get(currentUser.id, { sessionToken: token });
          }
          if (currentUser) {
            setIsUserValid(true);
          } else {
            setIsUserValid(false);
          }
        } catch (error) {
          console.log("err in validate", error);
          if (error?.code === 209 || error?.message?.includes("invalid session") || error?.message?.includes("Invalid session")) {
            setIsUserValid(false);
          } else {
            setIsUserValid(true);
          }
        }
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isUserValid ? <Outlet /> : <SessionExpiredModal />;
};

export default Validate;
