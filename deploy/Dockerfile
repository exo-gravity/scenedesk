# Resolve/update pinned manifests deliberately; no image pull occurs in the media runtime.
FROM docker:28.5.1-cli@sha256:9190b0613792e658a7783cf14b2d5ace5941bb68ede7276922ea36ee457d76ad AS docker-cli
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS application
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tests ./tests
COPY docs/implementation/openapi.json ./docs/implementation/openapi.json
RUN npm ci && npm run build
COPY deploy ./deploy
RUN ./node_modules/.bin/tsc -p deploy/tsconfig.json && node --import tsx --test deploy/tests/*.test.ts
ENV NODE_ENV=production
USER node

FROM application AS api
CMD ["node", "--import", "tsx", "deploy/runtime/api.ts"]

FROM application AS media-worker
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
CMD ["node", "--import", "tsx", "deploy/runtime/media-worker.ts"]

FROM nginx:alpine@sha256:b0f7830b6bfaa1258f45d94c240ab668ced1b3651c8a222aefe6683447c7bf55 AS web
COPY --from=application /workspace/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/nginx.conf
USER 101:101
ENTRYPOINT ["nginx", "-g", "daemon off;"]
