const userModel = require('../models/User');
const bcrypt = require("bcryptjs");
const { ObjectId } = require('mongodb');

exports.getAll = async (body, res) => {
    try {
        let data = await userModel.find();
        return res({status: 200, data});
    } catch (err) {
        return res({status: 500, message: "Something went wrong"});
    }
}

exports.searchUser = async (body, res) => {
    try {
        let page = parseInt(body.page || 1);
        let limit = parseInt(body.limit || 10);
        let query = {};
        if (body.searchQuery) {
            query['$or'] = [
                {'name': {$regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
                {'mobile': {$regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
                {'email': {$regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
            ]
        }
        let data = await userModel.find(query, {password: 0}).skip((page - 1) * limit).limit(parseInt(limit));
        const totalUsers = await userModel.countDocuments(query);
        return res({status: 200, data, total: totalUsers, pages: Math.ceil(totalUsers / limit), currentPage: page});
        // return res({status: 200, data});
    } catch (err) {
        return res({status: 500, message: "Something went wrong"});
    }
}

exports.addUser = async (body, res) => {
    try {
        let errorArray = [];
        if (body.mobile) {
            const oldMobile = await userModel.findOne({
                mobile: {$regex: new RegExp(`^${body.mobile.trim()}$`), "$options": "i"}
            });
            if (oldMobile)
                errorArray.push('Mobile already exists');
        } else {
            errorArray.push('Enter mobile number');
        }
        // const oldEmail = await userModel.findOne({email: {$regex: new RegExp(`^${body.email.trim()}$`), "$options": "i"}});
        // if (oldEmail)
        //     errorArray.push('Email already exists')

        if (errorArray.length) {
            return res({ status: 400, errors: errorArray })
        }

        body.password = await bcrypt.hash(body.password, 10);

        let userData = await userModel.insertMany(body);
        return res({status: 200, message: userData});
    } catch (err) {
        console.log(err);
        return res({status: 500, message: err.message});
    }
}

exports.userUpdate = async (id, body, res) => {
    try {
        let errorArray = [];
        if (body.mobile) {
            const oldMobile = await userModel.findOne({
                mobile: {
                    $regex: new RegExp(`^${body.mobile.trim()}$`),
                    "$options": "i"
                }
            });
            if (body.mobile !== undefined && oldMobile !== null && oldMobile._id.toString() !== id) {
                errorArray.push('Mobile already exists');
                // return res({ status: 400, message: 'Mobile already exists' });
            }
        } else {
            errorArray.push('Enter mobile number');
        }
        // const oldEmail = await userModel.findOne({ email: {$regex: new RegExp(`^${body.email.trim()}$`), "$options": "i"}});
        // if (body.email !== undefined && body.email !== null && oldEmail !== null && oldEmail._id.toString() !== id) {
        //     errorArray.push('Email already exists')
        //     // return res({ status: 400, message: 'Email already exists' });
        // }

        if (errorArray.length > 0) {
            return res({ status: 400, error: errorArray, })
        }
        let user = await userModel.updateOne({ _id: new ObjectId(id) }, { $set: body });
        return res({ status: 200, message: user });
    } catch (err) {
        console.log(err)
        return res({ status: 500, message: err });
    }
}

exports.getUser = async (id, res) => {
    try {
        const data = await userModel.findOne({_id: new ObjectId(id)}, {password: 0, token: 0});
        data.rewards = [
            {"title": "Redeemed Points", "description": "Redeemed Points Confirmation", "count": data.redeemedPoints},
            {"title": "Earned Cash Reward", "description": "Earned Cash Reward Confirmation", "count": data.cash},
        ];
        return res({status: 200, data: data})
    } catch (err) {
        return res({status: 500, message: err})
    }
}

exports.deleteUser = async (id, res) => {
    try {
        const data = await userModel.deleteOne({_id: new ObjectId(id)});
        return res({status: 200, data: data})
    } catch (err) {
        return res({status: 500, message: err})
    }
}

exports.toggleUserStatus = async (userId, res) => {
    try {
        // Find the user by their ID
        const user = await userModel.findById(userId); 
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
    
        // Toggle the user's status (active <-> inactive)
        user.status = user.status === 'active' ? 'inactive' : 'active';
    
        // Save only the status field (no need to revalidate other fields like mobile)
        await user.save({ validateModifiedOnly: true }); 
    
        // Respond with the updated user object
        return res.status(200).json({
            message: `User status has been successfully updated.`,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                status: user.status,  
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'An error occurred while toggling user status' });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const {_id, password } = req.body;
        const user = await userModel.findOne({ _id: new ObjectId(_id) });
        if (!user) {
            return res({ status: 400, message: 'User not found' })
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        user.password = hashedPassword;
        await user.save();
        return res({status: 200, message: 'Password has been reset successfully' })
    } catch (err) {
        console.log(err)
        return res({ status: 500, message: err });
    }
}
