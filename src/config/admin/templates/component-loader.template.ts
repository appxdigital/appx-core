export const componentLoaderTemplate = `import { dynamicImport } from "./utils";

async function loadComponents() {
    const { ComponentLoader } = await dynamicImport('adminjs');
    const componentLoader = new ComponentLoader();

    const Components = {
        Dashboard: componentLoader.add('dashboard', './components/dashboard'),
    };

    return { componentLoader, Components };
}
export const initializeComponents = loadComponents;
`