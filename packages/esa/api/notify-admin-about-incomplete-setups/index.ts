import { defaultHandler } from "@calcom/lib/server";

import { withMiddleware } from "../../middleware";

export default withMiddleware("verifyCronRoutesToken")(
  defaultHandler({
    POST: import("./_post"),
  })
);
