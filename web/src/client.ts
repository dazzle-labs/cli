import { createConnectTransport } from "@connectrpc/connect-web";
import { createClient } from "@connectrpc/connect";
import { StageService } from "./gen/api/v1/stage_pb.js";
import { ApiKeyService } from "./gen/api/v1/apikey_pb.js";
import { RtmpDestinationService } from "./gen/api/v1/stream_pb.js";
import { UserService } from "./gen/api/v1/user_pb.js";
import { FeaturedService } from "./gen/api/v1/featured_pb.js";

let getToken: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: () => Promise<string | null>) {
  getToken = fn;
}

const transport = createConnectTransport({
  baseUrl: "/",
  interceptors: [
    (next) => async (req) => {
      if (getToken) {
        const token = await getToken();
        if (token) {
          req.header.set("Authorization", `Bearer ${token}`);
        }
      }
      return next(req);
    },
  ],
});

export const stageClient = createClient(StageService, transport);
export const apiKeyClient = createClient(ApiKeyService, transport);
export const streamClient = createClient(RtmpDestinationService, transport);
export const userClient = createClient(UserService, transport);
export const featuredClient = createClient(FeaturedService, transport);
