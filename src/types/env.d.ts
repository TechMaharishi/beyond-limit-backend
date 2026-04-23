declare namespace NodeJS {
  interface ProcessEnv {
    PORT?: string;
    BETTER_AUTH_SECRET: string;
    NODE_ENV: "development" | "production";
    LOG_LEVEL: "debug" | "info" ;
    MONGO_URI: string;
    BETTER_AUTH_URL: string;  
    CLIENT_ORIGIN1: string;  
    CLIENT_ORIGIN2: string;  
    EMAIL: string;
    EMAIL_PASS: string;
    SENDGRID_API_KEY: string;
    ADMIN_USER_ID_1: string;
    ADMIN_USER_ID_2: string;
    CLOUDINARY_CLOUD_NAME: string;
    CLOUDINARY_API_KEY: string;
    CLOUDINARY_API_SECRET: string;
    SLACK_SUPPORT_WEBHOOK_URL: string;
    SLACK_BOT_TOKEN: string;
    SLACK_SUPPORT_CHANNEL_ID: string;
    EMAIL_SUPPORT: string;
  }
}
