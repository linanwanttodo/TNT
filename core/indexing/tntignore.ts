import fs from "fs";
import { IDE } from "..";
import { getGlobalTntIgnorePath } from "../util/paths";
import { gitIgArrayFromFile } from "./ignore";

export const getGlobalTntIgArray = () => {
  const contents = fs.readFileSync(getGlobalTntIgnorePath(), "utf8");
  return gitIgArrayFromFile(contents);
};

export const getWorkspaceTntIgArray = async (ide: IDE) => {
  const dirs = await ide.getWorkspaceDirs();
  return await dirs.reduce(
    async (accPromise, dir) => {
      const acc = await accPromise;
      try {
        const contents = await ide.readFile(`${dir}/.tntignore`);
        return [...acc, ...gitIgArrayFromFile(contents)];
      } catch (err) {
        console.error(err);
        return acc;
      }
    },
    Promise.resolve([] as string[]),
  );
};
