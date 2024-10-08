import type { NextMiddleware } from "next-api-middleware";

const messages = {
  TOKEN_NOT_SUPPLIED: "TOKEN_NOT_SUPPLIED",
  TOKEN_INVALID: "TOKEN_INVALID",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
};

const verifyToken = (authorization?: string): boolean => {
  if (!authorization) {
    throw new Error(messages.TOKEN_NOT_SUPPLIED);
  }
  if (authorization.split(" ")[0] !== "Bearer") {
    throw new Error(messages.TOKEN_INVALID);
  }
  const [, token] = authorization.split(" ");

  if (!token) {
    throw new Error(messages.TOKEN_NOT_SUPPLIED);
  }

  if (token !== process.env.CRON_ROUTES_SECRET_KEY) {
    throw new Error(messages.TOKEN_INVALID);
  }

  return true;
};

export const verifyCronRoutesToken: NextMiddleware = async function (req, res, next) {
  try {
    const { authorization } = req.headers;
    const _result = verifyToken(authorization);

    await next();
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      return res.status(401).json({
        message: Object.values(messages).includes(error.message) ? error.message : `${error.message}`,
      });
    }

    return res.status(401).json({
      message: `Unable to verify cron token`,
    });
  }
};
