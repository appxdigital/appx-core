import * as fs from 'fs';
export const capitalizeFirstLetter = (string: string) =>
  string.charAt(0).toUpperCase() + string.slice(1);

export const createFileIfNotExists = (filePath: string, content: string) => {
  console.log(`Creating ${filePath}...`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    console.log(`${filePath} created.`);
  } else {
    console.log(`${filePath} already exists, skipping.`);
  }
};
