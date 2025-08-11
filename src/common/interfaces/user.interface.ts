export interface UserCreateInput {
    email: string;
    password: string;
    name?: string;
}

export interface User {
    id: string;
    email: string;
    name?: string;
    role?: string;
    access_token?: string;
    refresh_token?: string;
}
