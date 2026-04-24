import { NextFunction, Request, Response } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendError } from "@/utils/api-response";
import { sendWelcomeEmail } from "@/utils/mailer";
import { subscribeEmailToMailchimpSafe } from "@/utils/mailchimp";
import cloudinary from "@/config/cloudinary";
import type { UploadApiResponse } from "cloudinary";

export const SignupUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawNewsletter = (req.body as any)?.newsletter;
    const newsletter = String(rawNewsletter).toLowerCase() === "true" || rawNewsletter === true;
    
    const response = await auth.api.signUpEmail({
      body: {
        name: req.body.name,
        email: req.body.email,
        password: req.body.password,
        newsletter,
        accountType: "free",
        rememberMe: req.body.rememberMe,
      },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });

    response.headers.forEach((value, key) => {
      res.append(key, value);
    });

    const data = await response.json();
    
    // Better Auth error responses have status >= 400
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(response.status).json({ data });
  } catch (error) {
    return next(error);
  }
}

export const SendVerificationOTP = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await auth.api.sendVerificationOTP({
      body: {
        email: req.body.email,
        type: "email-verification",
      }
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
}

export const VerifyEmailOTP = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await auth.api.verifyEmailOTP({
      body: {
        email: req.body.email,
        otp: req.body.otp,
      },
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
}

export const SigninUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await auth.api.signInEmail({
      body: {
        email: req.body.email,
        password: req.body.password,
        rememberMe: req.body.rememberMe,
      },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });

    response.headers.forEach((value, key) => {
      res.append(key, value);
    });

    const session = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(session);
    }

    return res.status(response.status).json({ session });
  } catch (error) {
    return next(error);
  }
}

export const SignoutUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await auth.api.signOut({
      headers: fromNodeHeaders(req.headers),
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
}

export const ForgetPasswordEmailOTP = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await auth.api.forgetPasswordEmailOTP({
      body: {
        email: req.body.email,
      },
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
}

export const CheckForgetPasswordEmailOTP = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await auth.api.checkVerificationOTP({
      body: {
        email: req.body.email,
        type: "forget-password",
        otp: req.body.otp,
      },
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
}

export const ChangeForgetPasswordEmailOTP = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await auth.api.resetPasswordEmailOTP({
      body: {
        email: req.body.email,
        otp: req.body.otp,
        password: req.body.password,
      },
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
}

export const UpdatePasswordUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await auth.api.changePassword({
      body: {
        newPassword: req.body.newPassword,
        currentPassword: req.body.currentPassword,
        revokeOtherSessions: req.body.revokeOtherSessions,
      },
      headers: fromNodeHeaders(req.headers),
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = session.user;
    const userDetails = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: (user as any).phone,
      image: (user as any).image,
      role: (user as any).role,
      emailVerified: user.emailVerified ?? null,
    };

    return res.status(200).json({ data: userDetails });
  } catch (error) {
    next(error);
  }
}

export const DeleteUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // const callbackURL = `${process.env.BETTER_AUTH_URL}/confirm-account-delete`;
    const data = await auth.api.deleteUser({
      body: {
        password: req.body.password,
        // callbackURL,
      },
      headers: fromNodeHeaders(req.headers),
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
} 

// Update current user's account info: name, phone
export const UpdateAccountInfo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const name = typeof req.body.name === "string" ? req.body.name.trim() : undefined;
    const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : undefined;

    if (!name && !phone) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // Basic phone validation: optional '+' followed by 7–15 digits
    if (phone !== undefined && phone.length > 0) {
      const phoneRegex = /^\+?[0-9]{7,15}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({
          error: "Invalid phone format. Use digits with optional leading '+', 7–15 characters.",
        });
      }
    }

    const payload: any = {};
    if (name !== undefined) payload.name = name;
    if (phone !== undefined) payload.phone = phone;

    if (Object.keys(payload).length > 0) {
      await auth.api.updateUser({
        body: payload,
        headers: fromNodeHeaders(req.headers),
      });
    }

    const refreshed = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const latest = refreshed?.user ?? user;

    return res.status(200).json({
      data: {
        id: (latest as any)?.id ?? user.id,
        name: (latest as any)?.name ?? name ?? user.name,
        email: (latest as any)?.email ?? user.email,
        phone: (latest as any)?.phone ?? phone ?? (user as any)?.phone ?? null,
      },
    });
  } catch (error) {
    next(error);
    return res.status(500).json({ error });
  }
};

// Upload profile photo to cloudinary and update user.image
export const UploadProfilePhoto = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded. Use field 'image'" });
    }
    if (!file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ error: "Invalid file type. Only images are allowed" });
    }

    const uploadResult: UploadApiResponse = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "profiles",
          public_id: String((user as any).id),
          overwrite: true,
          resource_type: "image",
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error("Upload failed"));
          resolve(result as UploadApiResponse);
        }
      );
      stream.end(file.buffer);
    });

    const imageUrl = uploadResult.secure_url;

    await auth.api.updateUser({
      body: { image: imageUrl },
      headers: fromNodeHeaders(req.headers),
    });

    return res.status(200).json({
      data: {
        image: imageUrl,
        publicId: uploadResult.public_id,
        width: uploadResult.width,
        height: uploadResult.height,
        format: uploadResult.format,
      },
    });
  } catch (error) {
    next(error);
    return res.status(500).json({ error });
  }
};

// Remove profile photo from Cloudinary and clear user.image
export const RemoveProfilePhoto = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const publicId = `profiles/${String((user as any).id)}`;

    // Attempt to delete the image from Cloudinary (ignore not found)
    await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: "image",
    });

    // Clear image in Better Auth user profile
    await auth.api.updateUser({
      body: { image: "" },
      headers: fromNodeHeaders(req.headers),
    });

    return res.status(200).json({
      data: {
        image: null,
        deleted: true,
      },
    });
  } catch (error) {
    next(error);
    return res.status(500).json({ error });
  }
};




