import express from "express";
import { SignupUser, SendVerificationOTP, VerifyEmailOTP, SigninUser, SignoutUser, UpdatePasswordUser, getMe, DeleteUser, ForgetPasswordEmailOTP, CheckForgetPasswordEmailOTP, ChangeForgetPasswordEmailOTP, UpdateAccountInfo, UploadProfilePhoto, RemoveProfilePhoto } from '@/controllers/onboarding/account-management'
import { upload } from "@/config/cloudinary";


const accountManagementRouter = express.Router();

accountManagementRouter.post("/sign-up/email", SignupUser);
accountManagementRouter.post("/email-otp/send-verification-otp", SendVerificationOTP);
accountManagementRouter.post("/verify-email-otp", VerifyEmailOTP);
accountManagementRouter.post("/sign-in/email", SigninUser);
accountManagementRouter.post("/sign-out", SignoutUser);
accountManagementRouter.post("/change-password", UpdatePasswordUser);
accountManagementRouter.post("/forget-password/email-otp", ForgetPasswordEmailOTP);
accountManagementRouter.post("/email-otp/check-verification-otp", CheckForgetPasswordEmailOTP);
accountManagementRouter.post("/email-otp/reset-password", ChangeForgetPasswordEmailOTP);
accountManagementRouter.post("/delete-account", DeleteUser);
accountManagementRouter.get("/me", getMe);
accountManagementRouter.post("/update-account-info", UpdateAccountInfo);
accountManagementRouter.post("/account/upload-profile-photo", upload.single("image"), UploadProfilePhoto);
accountManagementRouter.delete("/account/remove-profile-photo", RemoveProfilePhoto);


export default accountManagementRouter;
